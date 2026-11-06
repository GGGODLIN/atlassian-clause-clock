import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLAUSE_CLOCK_SEEDED_SCENARIOS,
  clipIntervalsToWindow,
  evaluateBitmapOracle,
  getSeededScenario,
  intersectIntervals,
  mergeIntervals,
  reconcileClauseClock,
  runClauseClockPbtAudit,
  subtractIntervals,
  sumIntervalMinutes,
} from '../src/core/index.ts';

test('Role 1.1: Hero scenario (hero-overlap-splicer) folds overlapping incidents, subtracts maintenance, applies SLA tier & prior approved credit, and apportions 60/40 vendor recovery', () => {
  const scenario = getSeededScenario('hero-overlap-splicer');
  assert.equal(scenario.contract.claimKey, 'JSM-402');
  assert.equal(scenario.contract.customerName, 'Acme Global Retail');
  assert.equal(scenario.contract.customerId, 'CUST-ACME-01');
  assert.equal(scenario.contract.billingMonth, '2026-11');
  assert.equal(scenario.contract.billingMonthTotalMinutes, 43200);
  assert.equal(scenario.contract.billingTimezone, 'America/New_York');
  assert.equal(scenario.contract.contractStatus, 'APPROVED');

  const receipt = reconcileClauseClock(scenario);

  // Interval algebra checks: [600, 660) + [630, 690) = [600, 690) (90m) \ [645, 660) (15m) = 75m
  assert.equal(receipt.mathBreakdown.rawIncidentMinutes, 120);
  assert.equal(receipt.mathBreakdown.mergedIncidentMinutes, 90);
  assert.equal(receipt.mathBreakdown.maintenanceDeductedMinutes, 15);
  assert.equal(receipt.mathBreakdown.netOutageMinutes, 75);
  assert.equal(receipt.intervalLedger.netOutageIntervals.length, 2);
  assert.deepEqual(
    receipt.intervalLedger.netOutageIntervals.map((i) => [i.startMinute, i.endMinute]),
    [
      [600, 645],
      [660, 690],
    ],
  );

  // Uptime & SLA tier checks: (43200 - 75) / 43200 = 99.8264% -> 10% tier (1000 bps)
  assert.equal(receipt.mathBreakdown.uptimePercentage, 99.8264);
  assert.equal(receipt.mathBreakdown.matchedTier.creditBps, 1000);
  assert.equal(receipt.mathBreakdown.grossCreditCents, 200000);
  assert.equal(receipt.mathBreakdown.priorApprovedCents, 50000);
  assert.equal(receipt.mathBreakdown.remainingCapBeforeCents, 550000);
  assert.equal(receipt.mathBreakdown.uncappedAvailableCreditCents, 150000);
  assert.equal(receipt.mathBreakdown.capTruncated, false);
  assert.equal(receipt.mathBreakdown.newCreditCents, 150000);
  assert.equal(receipt.mathBreakdown.remainingCapAfterCents, 400000);

  // Upstream vendor 60% / 40% split: 45m / 75m = 60% ($900) vendor, 30m / 75m = 40% ($600) internal
  assert.equal(receipt.mathBreakdown.vendorCoveredMinutes, 45);
  assert.equal(receipt.mathBreakdown.vendorTotalApportionedCents, 90000);
  assert.equal(receipt.mathBreakdown.internalAbsorbedMinutes, 30);
  assert.equal(receipt.mathBreakdown.internalAbsorbedCents, 60000);
  assert.equal(receipt.vendorApportionments.length, 1);
  assert.equal(receipt.vendorApportionments[0]?.vendorId, 'VEND-CLOUD-NET');
  assert.equal(receipt.vendorApportionments[0]?.overlapMinutes, 45);
  assert.equal(receipt.vendorApportionments[0]?.shareBps, 6000);
  assert.equal(receipt.vendorApportionments[0]?.apportionedCents, 90000);

  // Naive spreadsheet comparison: 120m -> 25% tier ($5,000) vs $1,500 -> $3,500 prevented
  assert.equal(receipt.naiveComparison.rawIncidentSumMinutes, 120);
  assert.equal(receipt.naiveComparison.naiveCreditBps, 2500);
  assert.equal(receipt.naiveComparison.naiveCreditCents, 500000);
  assert.equal(receipt.naiveComparison.overchargePreventedCents, 350000);
  assert.equal(receipt.naiveComparison.overcountedMinutes, 45);

  // Readable proposalVersionKey (zero SHA-256/MD5)
  assert.equal(
    receipt.proposalVersionKey,
    'CCLOCK-JSM-402-2026-11-NET75M-CRED150000-VEND90000',
  );
  assert.ok(receipt.replayCommand.includes('hero-overlap-splicer'));
});

test('Role 1.2: Cross-timezone boundary (cross-timezone-boundary) defaults missing timezone to UTC, clips pre-month minutes, and shifts under timezoneOverride', () => {
  const scenario = getSeededScenario('cross-timezone-boundary');
  assert.equal(scenario.contract.claimKey, 'JSM-418');
  assert.equal(scenario.contract.billingTimezone, undefined);

  const utcReceipt = reconcileClauseClock(scenario);
  assert.equal(utcReceipt.missingTimezoneFallback, true);
  assert.equal(utcReceipt.billingTimezone, 'UTC');
  assert.equal(utcReceipt.provenance.billingTimezoneResolved, 'UTC');
  assert.equal(utcReceipt.provenance.missingTimezoneFallback, true);
  assert.ok(utcReceipt.boundaryClippedCount > 0);
  assert.equal(utcReceipt.mathBreakdown.netOutageMinutes, 40);

  const shiftedReceipt = reconcileClauseClock(scenario, {
    timezoneOverride: 'America/Los_Angeles',
  });
  assert.equal(shiftedReceipt.missingTimezoneFallback, false);
  assert.equal(shiftedReceipt.billingTimezone, 'America/Los_Angeles');
  assert.notEqual(
    shiftedReceipt.mathBreakdown.netOutageMinutes,
    utcReceipt.mathBreakdown.netOutageMinutes,
  );
});

test('Role 1.3: Monthly cap truncation & 3-vendor equal-overlap Largest-Remainder tie-breaking (monthly-cap-truncation)', () => {
  const scenario = getSeededScenario('monthly-cap-truncation');
  assert.equal(scenario.contract.claimKey, 'JSM-425');

  const receipt = reconcileClauseClock(scenario);
  assert.equal(receipt.mathBreakdown.grossCreditCents, 300000);
  assert.equal(receipt.inputsSnapshot.monthlyCapCents, 400000);
  assert.equal(receipt.inputsSnapshot.priorApprovedCents, 320000);
  assert.equal(receipt.mathBreakdown.remainingCapBeforeCents, 80000);
  assert.equal(receipt.mathBreakdown.capTruncated, true);
  assert.equal(receipt.mathBreakdown.newCreditCents, 80000);
  assert.equal(receipt.mathBreakdown.remainingCapAfterCents, 0);

  // 3 vendors with equal 20m overlap each -> 80000 cents split via Largest Remainder into 26667 + 26667 + 26666 = 80000
  assert.equal(receipt.vendorApportionments.length, 3);
  assert.deepEqual(
    receipt.vendorApportionments.map((v) => v.overlapMinutes),
    [20, 20, 20],
  );
  assert.deepEqual(
    receipt.vendorApportionments.map((v) => v.apportionedCents),
    [26667, 26667, 26666],
  );
  assert.equal(receipt.mathBreakdown.vendorTotalApportionedCents, 80000);
  assert.equal(receipt.mathBreakdown.internalAbsorbedCents, 0);
});

test('Role 1.4: Unapproved contract draft (unapproved-contract-draft) flags provisionalDraftMode while computing preview receipt', () => {
  const scenario = getSeededScenario('unapproved-contract-draft');
  assert.equal(scenario.contract.claimKey, 'JSM-439');
  assert.equal(scenario.contract.contractStatus, 'DRAFT');

  const receipt = reconcileClauseClock(scenario);
  assert.equal(receipt.provisionalDraftMode, true);
  assert.equal(receipt.provenance.provisionalDraftMode, true);
  assert.ok(receipt.mathBreakdown.newCreditCents > 0);
  assert.equal(CLAUSE_CLOCK_SEEDED_SCENARIOS.length, 4);
});

test('Role 1.5: AI override guard ignores AI-supplied fee/credit/bps overrides and logs them in discardedAiAmountOverrides', () => {
  const scenario = getSeededScenario('hero-overlap-splicer');
  const baseline = reconcileClauseClock(scenario);
  assert.equal(baseline.discardedAiAmountOverrides.length, 0);

  const attempted = reconcileClauseClock(scenario, {
    aiOverrideAttempt: {
      monthlyFeeCents: 99999999,
      newCreditCents: 777777,
      creditBps: 5000,
      reason: 'Prompt injection attempt to inflate payout',
    },
  });

  // Positive control: overrides were recorded
  assert.ok(attempted.discardedAiAmountOverrides.length >= 3);
  assert.ok(
    attempted.discardedAiAmountOverrides.some((entry) => entry.includes('monthlyFeeCents')),
  );
  assert.ok(
    attempted.discardedAiAmountOverrides.some((entry) => entry.includes('newCreditCents')),
  );
  assert.ok(
    attempted.discardedAiAmountOverrides.some((entry) => entry.includes('creditBps')),
  );

  // Invariance check: locked contract figures remain untouched
  assert.equal(attempted.inputsSnapshot.monthlyFeeCents, baseline.inputsSnapshot.monthlyFeeCents);
  assert.equal(attempted.mathBreakdown.newCreditCents, baseline.mathBreakdown.newCreditCents);
  assert.equal(
    attempted.mathBreakdown.matchedTier.creditBps,
    baseline.mathBreakdown.matchedTier.creditBps,
  );
});

test('Role 1.6: Boundary cases (zero incidents, 100% maintenance coverage, exhausted monthly cap, and overlapping multi-vendor intervals) resolve without NaN or cent drift', () => {
  const baseScenario = getSeededScenario('hero-overlap-splicer');

  // Case A: All incidents disabled -> 0m net outage, 100% uptime, 0 credit, no NaN
  const zeroIncidentReceipt = reconcileClauseClock(baseScenario, {
    disabledIncidentIds: baseScenario.incidents.map((i) => i.id),
  });
  assert.equal(zeroIncidentReceipt.mathBreakdown.netOutageMinutes, 0);
  assert.equal(zeroIncidentReceipt.mathBreakdown.uptimePercentage, 100);
  assert.equal(zeroIncidentReceipt.mathBreakdown.newCreditCents, 0);
  assert.equal(zeroIncidentReceipt.mathBreakdown.vendorTotalApportionedCents, 0);
  assert.equal(zeroIncidentReceipt.mathBreakdown.internalAbsorbedCents, 0);
  assert.ok(
    zeroIncidentReceipt.vendorApportionments.every(
      (v) => !Number.isNaN(v.exactCents) && v.apportionedCents === 0,
    ),
  );

  // Case B: 100% maintenance coverage -> 0m net outage
  const fullMaintScenario = {
    ...baseScenario,
    maintenanceWindows: [
      {
        id: 'CHG-FULL',
        label: 'Full blanket window',
        startMinute: 500,
        endMinute: 800,
      },
    ],
  };
  const fullMaintReceipt = reconcileClauseClock(fullMaintScenario);
  assert.equal(fullMaintReceipt.mathBreakdown.netOutageMinutes, 0);
  assert.equal(fullMaintReceipt.mathBreakdown.newCreditCents, 0);

  // Case C: priorApprovedCents >= monthlyCapCents -> newCreditCents capped at 0
  const exhaustedCapScenario = {
    ...baseScenario,
    contract: {
      ...baseScenario.contract,
      priorApprovedCents: 650000,
      monthlyCapCents: 600000,
    },
  };
  const exhaustedReceipt = reconcileClauseClock(exhaustedCapScenario);
  assert.equal(exhaustedReceipt.mathBreakdown.remainingCapBeforeCents, 0);
  assert.equal(exhaustedReceipt.mathBreakdown.newCreditCents, 0);
  assert.equal(exhaustedReceipt.mathBreakdown.capTruncated, true);
  assert.equal(exhaustedReceipt.mathBreakdown.vendorTotalApportionedCents, 0);
  assert.equal(exhaustedReceipt.mathBreakdown.internalAbsorbedCents, 0);

  // Case D: Direct interval helper unit checks + evaluateBitmapOracle parity
  const clipped = clipIntervalsToWindow(
    [{ id: '1', label: 'A', startMinute: -15, endMinute: 30 }],
    0,
    100,
  );
  assert.equal(sumIntervalMinutes(clipped.clippedIntervals), 30);
  assert.equal(clipped.clippedCount, 1);
  const merged = mergeIntervals([
    { id: '1', label: 'A', startMinute: 10, endMinute: 50 },
    { id: '2', label: 'B', startMinute: 30, endMinute: 70 },
  ]);
  assert.equal(sumIntervalMinutes(merged), 60);
  const subtracted = subtractIntervals(merged, [
    { id: 'm1', label: 'M', startMinute: 20, endMinute: 40 },
  ]);
  assert.equal(sumIntervalMinutes(subtracted.remainingIntervals), 40);
  const intersected = intersectIntervals(subtracted.remainingIntervals, [
    { id: 'v1', label: 'V', startMinute: 15, endMinute: 60 },
  ]);
  assert.equal(sumIntervalMinutes(intersected), 25);

  const bitmapOracle = evaluateBitmapOracle({
    billingMonthTotalMinutes: 100,
    incidents: [
      { id: '1', label: 'A', startMinute: 10, endMinute: 50 },
      { id: '2', label: 'B', startMinute: 30, endMinute: 70 },
    ],
    maintenanceWindows: [{ id: 'm1', label: 'M', startMinute: 20, endMinute: 40 }],
    vendorFeeds: [
      {
        vendorId: 'v1',
        vendorName: 'Vendor 1',
        componentKey: 'comp-1',
        intervals: [{ id: 'vi1', label: 'V', startMinute: 15, endMinute: 60 }],
      },
    ],
  });
  assert.equal(bitmapOracle.netOutageMinutes, 40);
  assert.equal(bitmapOracle.vendorOverlapMinutesByVendorId['v1'], 25);
});

test('Role 2 & Role 3: runClauseClockPbtAudit verifies P1..P3 against Uint8Array(44640) bitmap oracle, reachability witnesses, oracle calibration, and counterexample replay', () => {
  const report = runClauseClockPbtAudit({ numRuns: 120, seed: 20261106 });

  assert.equal(report.passed, true);
  assert.deepEqual(report.invariants, {
    P1: true,
    P2: true,
    P3: true,
  });

  // Role 2 aggregate reachability witnesses
  assert.ok(report.reachabilityWitnesses.overlapFoldedCount > 0);
  assert.ok(report.reachabilityWitnesses.maintenanceDeductedCount > 0);
  assert.ok(report.reachabilityWitnesses.capTruncatedCount > 0);
  assert.ok(report.reachabilityWitnesses.multiVendorSplitCount > 0);

  // Role 3 individual oracle calibration controls
  assert.deepEqual(report.oracleCalibration, {
    p1NaiveSumDetected: true,
    p2UncappedDetected: true,
    p3FloatDriftDetected: true,
  });

  // Role 3 deterministic counterexample replay (naive 120m -> $5,000 vs ClauseClock 75m -> $1,500)
  assert.deepEqual(report.counterexampleReplay, {
    scenarioId: 'hero-overlap-splicer',
    naiveMinutes: 120,
    naiveCreditCents: 500000,
    clauseClockMinutes: 75,
    clauseClockCreditCents: 150000,
    overchargePreventedCents: 350000,
  });
});
