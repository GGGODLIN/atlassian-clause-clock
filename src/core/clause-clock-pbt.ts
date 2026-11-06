import fc from 'fast-check';
import {
  evaluateBitmapOracle,
  reconcileClauseClock,
} from './clause-clock-engine.ts';
import {
  CLAUSE_CLOCK_SEEDED_SCENARIOS,
  getSeededScenario,
  STANDARD_SLA_TIERS,
} from './clause-clock-scenarios.ts';
import type {
  CalculationReceipt,
  ClauseClockPbtAuditOptions,
  ClauseClockPbtAuditReport,
  ClauseClockScenario,
  HalfOpenInterval,
  VendorOutageFeed,
} from './clause-clock-types.ts';

export function checkP1IntervalEquivalence(
  scenario: ClauseClockScenario,
  receipt: CalculationReceipt,
): boolean {
  const oracle = evaluateBitmapOracle({
    billingMonthTotalMinutes: receipt.inputsSnapshot.billingMonthTotalMinutes,
    incidents: receipt.intervalLedger.clippedIncidents,
    maintenanceWindows: receipt.intervalLedger.clippedMaintenance,
    vendorFeeds: scenario.vendorFeeds,
  });

  if (
    receipt.mathBreakdown.netOutageMinutes !== oracle.netOutageMinutes ||
    receipt.mathBreakdown.mergedIncidentMinutes !== oracle.mergedIncidentMinutes ||
    receipt.mathBreakdown.maintenanceDeductedMinutes !== oracle.maintenanceDeductedMinutes
  ) {
    return false;
  }

  // Commutativity & Idempotence check: reverse + duplicate first incident
  const duplicatedIncidents =
    scenario.incidents.length > 0
      ? [
          ...scenario.incidents.slice().reverse(),
          { ...scenario.incidents[0]!, id: `${scenario.incidents[0]!.id}-dup` },
        ]
      : [];
  const reversedMaintenance = scenario.maintenanceWindows.slice().reverse();
  const permutedReceipt = reconcileClauseClock({
    ...scenario,
    incidents: duplicatedIncidents,
    maintenanceWindows: reversedMaintenance,
  });

  if (
    permutedReceipt.mathBreakdown.netOutageMinutes !== receipt.mathBreakdown.netOutageMinutes ||
    permutedReceipt.mathBreakdown.newCreditCents !== receipt.mathBreakdown.newCreditCents
  ) {
    return false;
  }

  // Split-invariance check: split the first incident with duration >= 2m into two contiguous halves
  const splittableIndex = scenario.incidents.findIndex(
    (inc) => inc.endMinute - inc.startMinute >= 2,
  );
  if (splittableIndex >= 0) {
    const target = scenario.incidents[splittableIndex]!;
    const mid = Math.floor((target.startMinute + target.endMinute) / 2);
    const splitIncidents: HalfOpenInterval[] = [
      ...scenario.incidents.slice(0, splittableIndex),
      { ...target, id: `${target.id}-part1`, endMinute: mid },
      { ...target, id: `${target.id}-part2`, startMinute: mid },
      ...scenario.incidents.slice(splittableIndex + 1),
    ];
    const splitReceipt = reconcileClauseClock({
      ...scenario,
      incidents: splitIncidents,
    });
    if (
      splitReceipt.mathBreakdown.netOutageMinutes !== receipt.mathBreakdown.netOutageMinutes ||
      splitReceipt.mathBreakdown.newCreditCents !== receipt.mathBreakdown.newCreditCents
    ) {
      return false;
    }
  }

  return true;
}

export function checkP2MonotonicityAndCapLock(
  scenario: ClauseClockScenario,
  receipt: CalculationReceipt,
): boolean {
  const remainingCap = Math.max(
    0,
    scenario.contract.monthlyCapCents - scenario.contract.priorApprovedCents,
  );

  if (
    !Number.isInteger(receipt.mathBreakdown.newCreditCents) ||
    receipt.mathBreakdown.newCreditCents < 0 ||
    receipt.mathBreakdown.newCreditCents > remainingCap
  ) {
    return false;
  }

  // Monotonicity: adding an extra incident window cannot decrease netOutageMinutes or newCreditCents
  const extraIncident: HalfOpenInterval = {
    id: 'INC-PBT-EXTRA',
    label: 'Additional Outage Pulse',
    startMinute: 100,
    endMinute: 250,
    included: true,
  };
  const augmentedReceipt = reconcileClauseClock({
    ...scenario,
    incidents: [...scenario.incidents, extraIncident],
  });

  if (
    augmentedReceipt.mathBreakdown.netOutageMinutes < receipt.mathBreakdown.netOutageMinutes ||
    augmentedReceipt.mathBreakdown.newCreditCents < receipt.mathBreakdown.newCreditCents
  ) {
    return false;
  }

  // Contract fee lock: AI override must be rejected and logged
  const overrideReceipt = reconcileClauseClock(scenario, {
    aiOverrideAttempt: {
      monthlyFeeCents: scenario.contract.monthlyFeeCents + 999999,
      newCreditCents: receipt.mathBreakdown.newCreditCents + 555555,
      creditBps: 9900,
    },
  });

  if (
    overrideReceipt.mathBreakdown.newCreditCents !== receipt.mathBreakdown.newCreditCents ||
    overrideReceipt.inputsSnapshot.monthlyFeeCents !== scenario.contract.monthlyFeeCents ||
    overrideReceipt.discardedAiAmountOverrides.length === 0
  ) {
    return false;
  }

  return true;
}

export function checkP3VendorCentConservation(receipt: CalculationReceipt): boolean {
  if (
    !Number.isInteger(receipt.mathBreakdown.internalAbsorbedCents) ||
    receipt.mathBreakdown.internalAbsorbedCents < 0
  ) {
    return false;
  }

  let vendorSum = 0;
  for (const row of receipt.vendorApportionments) {
    if (
      !Number.isInteger(row.apportionedCents) ||
      row.apportionedCents < 0 ||
      Number.isNaN(row.exactCents) ||
      Number.isNaN(row.remainderFraction)
    ) {
      return false;
    }
    vendorSum += row.apportionedCents;
  }

  if (vendorSum !== receipt.mathBreakdown.vendorTotalApportionedCents) {
    return false;
  }

  return vendorSum + receipt.mathBreakdown.internalAbsorbedCents === receipt.mathBreakdown.newCreditCents;
}

export function runClauseClockPbtAudit(
  options?: ClauseClockPbtAuditOptions,
): ClauseClockPbtAuditReport {
  const numRuns = Math.max(10, Math.min(500, options?.numRuns ?? 100));
  const seed = options?.seed ?? 20261106;

  let p1Passed = true;
  let p2Passed = true;
  let p3Passed = true;

  const reachabilityWitnesses = {
    overlapFoldedCount: 0,
    maintenanceDeductedCount: 0,
    capTruncatedCount: 0,
    multiVendorSplitCount: 0,
  };

  // Role 1: Check all 4 canonical seeded scenarios first
  for (const seeded of CLAUSE_CLOCK_SEEDED_SCENARIOS) {
    const receipt = reconcileClauseClock(seeded);
    if (!checkP1IntervalEquivalence(seeded, receipt)) {
      p1Passed = false;
    }
    if (!checkP2MonotonicityAndCapLock(seeded, receipt)) {
      p2Passed = false;
    }
    if (!checkP3VendorCentConservation(receipt)) {
      p3Passed = false;
    }
  }

  // Role 2: fast-check property guardian over bounded domain [0, 44640]
  const intervalArb: fc.Arbitrary<HalfOpenInterval> = fc
    .tuple(fc.integer({ min: 0, max: 3000 }), fc.integer({ min: 15, max: 400 }))
    .map(([start, duration]): HalfOpenInterval => ({
      id: `INC-GEN-${start}-${duration}`,
      label: `Generated Interval ${start}..${start + duration}`,
      startMinute: start,
      endMinute: Math.min(44640, start + duration),
      included: true,
    }));

  const scenarioArb: fc.Arbitrary<ClauseClockScenario> = fc
    .record({
      billingMonthTotalMinutes: fc.constantFrom(40320, 43200, 44640),
      monthlyFeeCents: fc.integer({ min: 500000, max: 5000000 }),
      capRatioBps: fc.integer({ min: 500, max: 4000 }),
      priorRatioBps: fc.integer({ min: 0, max: 9500 }),
      anchorStart: fc.integer({ min: 100, max: 2000 }),
      anchorDuration: fc.integer({ min: 60, max: 300 }),
      overlapOffset: fc.integer({ min: 10, max: 50 }),
      overlapDuration: fc.integer({ min: 40, max: 240 }),
      extraIncidents: fc.array(intervalArb, { minLength: 0, maxLength: 3 }),
      includeMaintenanceOverlap: fc.boolean(),
      vendorCount: fc.integer({ min: 1, max: 5 }),
    })
    .map((cfg): ClauseClockScenario => {
      const monthlyCapCents = Math.max(
        10000,
        Math.floor((cfg.monthlyFeeCents * cfg.capRatioBps) / 10000),
      );
      const priorApprovedCents = Math.min(
        monthlyCapCents,
        Math.floor((monthlyCapCents * cfg.priorRatioBps) / 10000),
      );

      const inc1Start = cfg.anchorStart;
      const inc1End = Math.min(cfg.billingMonthTotalMinutes, inc1Start + cfg.anchorDuration);
      const inc2Start = Math.min(inc1End - 5, inc1Start + cfg.overlapOffset);
      const inc2End = Math.min(cfg.billingMonthTotalMinutes, inc2Start + cfg.overlapDuration);

      const incidents: HalfOpenInterval[] = [
        {
          id: 'INC-ANCHOR-1',
          label: 'Primary Outage Window',
          startMinute: inc1Start,
          endMinute: Math.max(inc1Start + 10, inc1End),
          included: true,
        },
        {
          id: 'INC-ANCHOR-2',
          label: 'Overlapping Outage Window',
          startMinute: Math.max(0, inc2Start),
          endMinute: Math.max(inc2Start + 10, inc2End),
          included: true,
        },
        ...cfg.extraIncidents.map((item, idx) => ({
          ...item,
          id: `INC-EXTRA-${idx}`,
          endMinute: Math.min(cfg.billingMonthTotalMinutes, item.endMinute),
        })),
      ];

      const maintenanceWindows: HalfOpenInterval[] = cfg.includeMaintenanceOverlap
        ? [
            {
              id: 'CHG-GEN-1',
              label: 'Scheduled Maintenance Exclusion',
              startMinute: inc1Start + 5,
              endMinute: Math.min(inc1End, inc1Start + 25),
              included: true,
            },
          ]
        : [];

      const vendorSliceLen = Math.max(5, Math.floor(cfg.anchorDuration / cfg.vendorCount));
      const vendorFeeds: VendorOutageFeed[] = Array.from(
        { length: cfg.vendorCount },
        (_, vIdx): VendorOutageFeed => {
          const vStart = inc1Start + vIdx * Math.floor(vendorSliceLen / 2);
          const vEnd = Math.min(cfg.billingMonthTotalMinutes, vStart + vendorSliceLen);
          return {
            vendorId: `VEND-GEN-${vIdx + 1}`,
            vendorName: `Upstream Provider ${vIdx + 1}`,
            componentKey: `comp-${vIdx + 1}`,
            intervals: [
              {
                id: `VOUT-GEN-${vIdx + 1}`,
                label: `Provider ${vIdx + 1} Window`,
                startMinute: vStart,
                endMinute: Math.max(vStart + 5, vEnd),
                included: true,
              },
            ],
          };
        },
      );

      return {
        scenarioId: 'pbt-generated-scenario',
        title: 'PBT Generated Scenario',
        subtitle: 'Generated by fast-check',
        description: 'Randomized scenario within [0, 44640] minute domain',
        sourceMode: 'SEEDED_FIXTURE',
        contract: {
          contractId: 'CTR-PBT',
          customerName: 'PBT Synthetic Enterprise',
          customerId: 'CUST-PBT',
          claimKey: 'JSM-PBT',
          billingMonth: '2026-11',
          billingMonthTotalMinutes: cfg.billingMonthTotalMinutes,
          billingTimezone: 'UTC',
          contractStatus: 'APPROVED',
          monthlyFeeCents: cfg.monthlyFeeCents,
          monthlyCapCents,
          priorApprovedCents,
          confluenceContractUrl: 'https://example.atlassian.net/wiki/spaces/SLA/pages/1',
          slaTiers: [...STANDARD_SLA_TIERS],
        },
        incidents,
        maintenanceWindows,
        vendorFeeds,
      };
    });

  const safetyProperty = fc.property(scenarioArb, (generatedScenario) => {
    const receipt = reconcileClauseClock(generatedScenario);

    const p1Ok = checkP1IntervalEquivalence(generatedScenario, receipt);
    const p2Ok = checkP2MonotonicityAndCapLock(generatedScenario, receipt);
    const p3Ok = checkP3VendorCentConservation(receipt);

    if (!p1Ok) {
      p1Passed = false;
    }
    if (!p2Ok) {
      p2Passed = false;
    }
    if (!p3Ok) {
      p3Passed = false;
    }

    if (receipt.mathBreakdown.rawIncidentMinutes > receipt.mathBreakdown.mergedIncidentMinutes) {
      reachabilityWitnesses.overlapFoldedCount += 1;
    }
    if (receipt.mathBreakdown.maintenanceDeductedMinutes > 0) {
      reachabilityWitnesses.maintenanceDeductedCount += 1;
    }
    if (receipt.mathBreakdown.capTruncated) {
      reachabilityWitnesses.capTruncatedCount += 1;
    }
    if (
      receipt.vendorApportionments.filter((v) => v.apportionedCents > 0).length >= 2
    ) {
      reachabilityWitnesses.multiVendorSplitCount += 1;
    }

    return p1Ok && p2Ok && p3Ok;
  });

  fc.assert(safetyProperty, { numRuns, seed });

  const witnessesReached =
    reachabilityWitnesses.overlapFoldedCount > 0 &&
    reachabilityWitnesses.maintenanceDeductedCount > 0 &&
    reachabilityWitnesses.capTruncatedCount > 0 &&
    reachabilityWitnesses.multiVendorSplitCount > 0;

  // Role 3: Individual Oracle Calibration (test-local mutations without production fault switches)
  const heroScenario = getSeededScenario('hero-overlap-splicer');
  const heroReceipt = reconcileClauseClock(heroScenario);
  const mutatedP1Receipt: CalculationReceipt = {
    ...heroReceipt,
    mathBreakdown: {
      ...heroReceipt.mathBreakdown,
      netOutageMinutes: heroReceipt.mathBreakdown.rawIncidentMinutes, // 120m naive sum instead of 75m
    },
  };
  const p1NaiveSumDetected = !checkP1IntervalEquivalence(heroScenario, mutatedP1Receipt);

  const capScenario = getSeededScenario('monthly-cap-truncation');
  const capReceipt = reconcileClauseClock(capScenario);
  const mutatedP2Receipt: CalculationReceipt = {
    ...capReceipt,
    mathBreakdown: {
      ...capReceipt.mathBreakdown,
      newCreditCents: capReceipt.mathBreakdown.grossCreditCents, // 300000 uncapped > 80000 remaining cap
    },
  };
  const p2UncappedDetected = !checkP2MonotonicityAndCapLock(capScenario, mutatedP2Receipt);

  const mutatedP3Receipt: CalculationReceipt = {
    ...capReceipt,
    vendorApportionments: capReceipt.vendorApportionments.map((v) => ({
      ...v,
      apportionedCents: Math.floor(capReceipt.mathBreakdown.newCreditCents / 3), // 26666 * 3 = 79998 !== 80000
    })),
  };
  const p3FloatDriftDetected = !checkP3VendorCentConservation(mutatedP3Receipt);

  const counterexampleReplay = {
    scenarioId: heroScenario.scenarioId,
    naiveMinutes: heroReceipt.naiveComparison.rawIncidentSumMinutes,
    naiveCreditCents: heroReceipt.naiveComparison.naiveCreditCents,
    clauseClockMinutes: heroReceipt.mathBreakdown.netOutageMinutes,
    clauseClockCreditCents: heroReceipt.mathBreakdown.newCreditCents,
    overchargePreventedCents: heroReceipt.naiveComparison.overchargePreventedCents,
  };

  const passed =
    p1Passed &&
    p2Passed &&
    p3Passed &&
    witnessesReached &&
    p1NaiveSumDetected &&
    p2UncappedDetected &&
    p3FloatDriftDetected;

  return {
    passed,
    numRuns,
    seed,
    invariants: {
      P1: p1Passed,
      P2: p2Passed,
      P3: p3Passed,
    },
    reachabilityWitnesses,
    oracleCalibration: {
      p1NaiveSumDetected,
      p2UncappedDetected,
      p3FloatDriftDetected,
    },
    counterexampleReplay,
  };
}
