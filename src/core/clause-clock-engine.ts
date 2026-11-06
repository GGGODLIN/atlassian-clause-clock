import type {
  BitmapOracleInput,
  BitmapOracleResult,
  CalculationReceipt,
  ClauseClockScenario,
  HalfOpenInterval,
  MarkdownExports,
  NaiveSpreadsheetComparison,
  ReconcileOptions,
  SlaCreditTier,
  SourceProvenanceManifest,
  VendorApportionmentRow,
  VendorOutageFeed,
} from './clause-clock-types.ts';

export const MAX_BILLING_MONTH_MINUTES = 44640;

const KNOWN_TIMEZONE_OFFSETS_MINUTES: Readonly<Record<string, number>> = {
  UTC: 0,
  'Etc/UTC': 0,
  GMT: 0,
  'America/New_York': -300,
  'America/Chicago': -360,
  'America/Denver': -420,
  'America/Los_Angeles': -480,
  'Europe/London': 0,
  'Europe/Berlin': 60,
  'Asia/Tokyo': 540,
  'Asia/Taipei': 480,
  'Australia/Sydney': 660,
};

export function resolveTimezoneOffsetMinutes(timezone: string): number {
  const normalized = timezone.trim();
  if (normalized in KNOWN_TIMEZONE_OFFSETS_MINUTES) {
    return KNOWN_TIMEZONE_OFFSETS_MINUTES[normalized]!;
  }
  try {
    const refDate = new Date(Date.UTC(2026, 10, 1, 12, 0, 0));
    const utcStr = refDate.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzStr = refDate.toLocaleString('en-US', { timeZone: normalized });
    const diffMs = new Date(tzStr).getTime() - new Date(utcStr).getTime();
    const diffMin = Math.round(diffMs / 60000);
    return Number.isFinite(diffMin) ? diffMin : 0;
  } catch {
    return 0;
  }
}

export function sumIntervalMinutes(intervals: readonly HalfOpenInterval[]): number {
  let total = 0;
  for (const interval of intervals) {
    if (interval.included === false) {
      continue;
    }
    const start = Math.floor(interval.startMinute);
    const end = Math.floor(interval.endMinute);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      total += end - start;
    }
  }
  return total;
}

export type ClippedIntervalsResult = HalfOpenInterval[] & {
  clippedIntervals: HalfOpenInterval[];
  clippedCount: number;
};

export function clipIntervalsToWindow(
  intervals: readonly HalfOpenInterval[],
  windowStartMinute: number,
  windowEndMinute: number,
  shiftMinutes = 0,
): ClippedIntervalsResult {
  const lo = Math.floor(windowStartMinute);
  const hi = Math.max(lo, Math.floor(windowEndMinute));
  const shift = Math.floor(shiftMinutes);
  const result: HalfOpenInterval[] = [];
  let clippedCount = 0;

  for (const raw of intervals) {
    if (raw.included === false) {
      continue;
    }
    const shiftedStart = Math.floor(raw.startMinute) + shift;
    const shiftedEnd = Math.floor(raw.endMinute) + shift;
    if (!Number.isFinite(shiftedStart) || !Number.isFinite(shiftedEnd) || shiftedEnd <= shiftedStart) {
      continue;
    }
    if (shiftedStart < lo || shiftedEnd > hi) {
      clippedCount += 1;
    }
    const clampedStart = Math.max(lo, Math.min(hi, shiftedStart));
    const clampedEnd = Math.max(lo, Math.min(hi, shiftedEnd));
    if (clampedEnd > clampedStart) {
      result.push({
        ...raw,
        startMinute: clampedStart,
        endMinute: clampedEnd,
        included: true,
      });
    }
  }

  return Object.assign(result, {
    clippedIntervals: result,
    clippedCount,
  });
}

export function mergeIntervals(intervals: readonly HalfOpenInterval[]): HalfOpenInterval[] {
  const valid = intervals
    .filter(
      (item) =>
        item.included !== false &&
        Number.isFinite(item.startMinute) &&
        Number.isFinite(item.endMinute) &&
        Math.floor(item.endMinute) > Math.floor(item.startMinute),
    )
    .map((item) => ({
      ...item,
      startMinute: Math.floor(item.startMinute),
      endMinute: Math.floor(item.endMinute),
      included: true,
    }))
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute || a.id.localeCompare(b.id));

  if (valid.length === 0) {
    return [];
  }

  const merged: HalfOpenInterval[] = [];
  for (const current of valid) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push({ ...current });
      continue;
    }
    if (current.startMinute <= previous.endMinute) {
      const mergedEnd = Math.max(previous.endMinute, current.endMinute);
      const combinedId = previous.id.includes(current.id)
        ? previous.id
        : `${previous.id}+${current.id}`;
      const combinedLabel = previous.label.includes(current.label)
        ? previous.label
        : `${previous.label} + ${current.label}`;
      merged[merged.length - 1] = {
        ...previous,
        id: combinedId,
        label: combinedLabel,
        endMinute: mergedEnd,
      };
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

export type SubtractIntervalsResult = HalfOpenInterval[] & {
  remainingIntervals: HalfOpenInterval[];
  deductedSlices: HalfOpenInterval[];
};

export function subtractIntervals(
  sourceIntervals: readonly HalfOpenInterval[],
  exclusionIntervals: readonly HalfOpenInterval[],
): SubtractIntervalsResult {
  const mergedSource = mergeIntervals(sourceIntervals);
  const mergedExclusions = mergeIntervals(exclusionIntervals);

  if (mergedSource.length === 0) {
    const empty: HalfOpenInterval[] = [];
    return Object.assign(empty, {
      remainingIntervals: empty,
      deductedSlices: [],
    });
  }

  if (mergedExclusions.length === 0) {
    const unchanged = mergedSource.map((item) => ({ ...item }));
    return Object.assign(unchanged, {
      remainingIntervals: unchanged,
      deductedSlices: [],
    });
  }

  const remaining: HalfOpenInterval[] = [];
  const deductedSlices: HalfOpenInterval[] = [];

  for (const src of mergedSource) {
    let cursor = src.startMinute;
    let sliceIndex = 0;

    for (const excl of mergedExclusions) {
      if (excl.endMinute <= cursor) {
        continue;
      }
      if (excl.startMinute >= src.endMinute) {
        break;
      }

      if (excl.startMinute > cursor) {
        sliceIndex += 1;
        remaining.push({
          ...src,
          id: `${src.id}#net-${sliceIndex}`,
          startMinute: cursor,
          endMinute: excl.startMinute,
        });
      }

      const deductStart = Math.max(cursor, excl.startMinute);
      const deductEnd = Math.min(src.endMinute, excl.endMinute);
      if (deductEnd > deductStart) {
        deductedSlices.push({
          id: `${src.id}-minus-${excl.id}-${deductStart}-${deductEnd}`,
          label: `${excl.label} deducted from ${src.label}`,
          startMinute: deductStart,
          endMinute: deductEnd,
          sourceKey: excl.sourceKey ?? excl.id,
          included: true,
        });
      }

      cursor = Math.max(cursor, excl.endMinute);
      if (cursor >= src.endMinute) {
        break;
      }
    }

    if (cursor < src.endMinute) {
      sliceIndex += 1;
      remaining.push({
        ...src,
        id: sliceIndex === 1 && cursor === src.startMinute ? src.id : `${src.id}#net-${sliceIndex}`,
        startMinute: cursor,
        endMinute: src.endMinute,
      });
    }
  }

  return Object.assign(remaining, {
    remainingIntervals: remaining,
    deductedSlices,
  });
}

export function intersectIntervals(
  leftIntervals: readonly HalfOpenInterval[],
  rightIntervals: readonly HalfOpenInterval[],
): HalfOpenInterval[] {
  const mergedLeft = mergeIntervals(leftIntervals);
  const mergedRight = mergeIntervals(rightIntervals);
  const intersections: HalfOpenInterval[] = [];

  for (const left of mergedLeft) {
    for (const right of mergedRight) {
      const start = Math.max(left.startMinute, right.startMinute);
      const end = Math.min(left.endMinute, right.endMinute);
      if (end > start) {
        intersections.push({
          id: `${left.id}∩${right.id}@${start}-${end}`,
          label: `${right.label} (${start}m-${end}m)`,
          startMinute: start,
          endMinute: end,
          sourceKey: right.sourceKey ?? right.id,
          included: true,
        });
      }
    }
  }

  return mergeIntervals(intersections);
}

export function evaluateBitmapOracle(params: BitmapOracleInput): BitmapOracleResult {
  const windowMinutes = Math.max(
    0,
    Math.min(MAX_BILLING_MONTH_MINUTES, Math.floor(params.billingMonthTotalMinutes)),
  );
  const incidentBitmap = new Uint8Array(MAX_BILLING_MONTH_MINUTES);
  const maintenanceBitmap = new Uint8Array(MAX_BILLING_MONTH_MINUTES);

  for (const inc of params.incidents) {
    if (inc.included === false) {
      continue;
    }
    const start = Math.max(0, Math.min(windowMinutes, Math.floor(inc.startMinute)));
    const end = Math.max(0, Math.min(windowMinutes, Math.floor(inc.endMinute)));
    for (let t = start; t < end; t += 1) {
      incidentBitmap[t] = 1;
    }
  }

  for (const maint of params.maintenanceWindows) {
    if (maint.included === false) {
      continue;
    }
    const start = Math.max(0, Math.min(windowMinutes, Math.floor(maint.startMinute)));
    const end = Math.max(0, Math.min(windowMinutes, Math.floor(maint.endMinute)));
    for (let t = start; t < end; t += 1) {
      maintenanceBitmap[t] = 1;
    }
  }

  let mergedIncidentMinutes = 0;
  let maintenanceDeductedMinutes = 0;
  let netOutageMinutes = 0;

  for (let t = 0; t < windowMinutes; t += 1) {
    if (incidentBitmap[t] === 1) {
      mergedIncidentMinutes += 1;
      if (maintenanceBitmap[t] === 1) {
        maintenanceDeductedMinutes += 1;
      } else {
        netOutageMinutes += 1;
      }
    }
  }

  const vendorUnionBitmap = new Uint8Array(MAX_BILLING_MONTH_MINUTES);
  const vendorOverlapMinutesByVendorId: Record<string, number> = {};

  for (const vendor of params.vendorFeeds ?? []) {
    const vendorBitmap = new Uint8Array(MAX_BILLING_MONTH_MINUTES);
    for (const interval of vendor.intervals) {
      if (interval.included === false) {
        continue;
      }
      const start = Math.max(0, Math.min(windowMinutes, Math.floor(interval.startMinute)));
      const end = Math.max(0, Math.min(windowMinutes, Math.floor(interval.endMinute)));
      for (let t = start; t < end; t += 1) {
        vendorBitmap[t] = 1;
      }
    }

    let overlapCount = 0;
    for (let t = 0; t < windowMinutes; t += 1) {
      if (incidentBitmap[t] === 1 && maintenanceBitmap[t] === 0 && vendorBitmap[t] === 1) {
        overlapCount += 1;
        vendorUnionBitmap[t] = 1;
      }
    }
    vendorOverlapMinutesByVendorId[vendor.vendorId] = overlapCount;
  }

  let vendorCoveredUnionMinutes = 0;
  for (let t = 0; t < windowMinutes; t += 1) {
    if (incidentBitmap[t] === 1 && maintenanceBitmap[t] === 0 && vendorUnionBitmap[t] === 1) {
      vendorCoveredUnionMinutes += 1;
    }
  }

  return {
    netOutageMinutes,
    mergedIncidentMinutes,
    maintenanceDeductedMinutes,
    vendorCoveredUnionMinutes,
    vendorOverlapMinutesByVendorId,
  };
}

export function matchSlaCreditTier(
  slaTiers: readonly SlaCreditTier[],
  outageMinutes: number,
  billingMonthTotalMinutes: number,
): {
  uptimePercentage: number;
  uptimeBps: number;
  matchedTier: SlaCreditTier;
} {
  const safeTotalMinutes = Math.max(1, Math.floor(billingMonthTotalMinutes));
  const clampedOutage = Math.max(0, Math.min(safeTotalMinutes, Math.floor(outageMinutes)));
  const uptimeRatio = (safeTotalMinutes - clampedOutage) / safeTotalMinutes;
  const uptimePercentage =
    clampedOutage === 0 ? 100 : Number((uptimeRatio * 100).toFixed(4));
  const uptimeBps =
    clampedOutage === 0 ? 10000 : Math.max(0, Math.min(10000, Math.floor(uptimeRatio * 10000)));

  const fallbackTier: SlaCreditTier = {
    tierId: 'TIER-DEFAULT-0',
    label: 'Default Compliant Tier',
    minUptimeBps: 0,
    maxUptimeBps: 10000,
    creditBps: 0,
  };

  if (slaTiers.length === 0) {
    return { uptimePercentage, uptimeBps, matchedTier: fallbackTier };
  }

  const byOutageRange = slaTiers.find(
    (tier) =>
      tier.minOutageMinutes !== undefined &&
      tier.maxOutageMinutes !== undefined &&
      clampedOutage >= tier.minOutageMinutes &&
      clampedOutage <= tier.maxOutageMinutes,
  );
  if (byOutageRange) {
    return { uptimePercentage, uptimeBps, matchedTier: byOutageRange };
  }

  const byUptimeRange = slaTiers.find(
    (tier) => uptimeBps >= tier.minUptimeBps && uptimeBps <= tier.maxUptimeBps,
  );
  if (byUptimeRange) {
    return { uptimePercentage, uptimeBps, matchedTier: byUptimeRange };
  }

  const sortedByUptimeDesc = [...slaTiers].sort((a, b) => b.minUptimeBps - a.minUptimeBps);
  const highestSeverity = sortedByUptimeDesc[sortedByUptimeDesc.length - 1] ?? fallbackTier;
  const lowestSeverity = sortedByUptimeDesc[0] ?? fallbackTier;

  return {
    uptimePercentage,
    uptimeBps,
    matchedTier: clampedOutage === 0 ? lowestSeverity : highestSeverity,
  };
}

function apportionVendorAndInternalCents(params: {
  vendorFeeds: readonly VendorOutageFeed[];
  netOutageIntervals: readonly HalfOpenInterval[];
  netOutageMinutes: number;
  newCreditCents: number;
  windowStartMinute: number;
  windowEndMinute: number;
  shiftMinutes: number;
}): {
  vendorApportionments: VendorApportionmentRow[];
  vendorCoveredMinutes: number;
  vendorTotalApportionedCents: number;
  internalAbsorbedMinutes: number;
  internalAbsorbedCents: number;
} {
  const {
    vendorFeeds,
    netOutageIntervals,
    netOutageMinutes,
    newCreditCents,
    windowStartMinute,
    windowEndMinute,
    shiftMinutes,
  } = params;

  const rawRows = vendorFeeds.map((feed) => {
    const clippedFeed = clipIntervalsToWindow(
      feed.intervals,
      windowStartMinute,
      windowEndMinute,
      shiftMinutes,
    );
    const overlapIntervals = intersectIntervals(netOutageIntervals, clippedFeed);
    const overlapMinutes = sumIntervalMinutes(overlapIntervals);
    return {
      vendorId: feed.vendorId,
      vendorName: feed.vendorName,
      componentKey: feed.componentKey,
      overlapIntervals,
      overlapMinutes,
    };
  });

  const allOverlapSlices = rawRows.flatMap((row) => row.overlapIntervals);
  const mergedVendorUnion = mergeIntervals(allOverlapSlices);
  const vendorCoveredMinutes = Math.min(
    netOutageMinutes,
    sumIntervalMinutes(mergedVendorUnion),
  );
  const internalAbsorbedMinutes = Math.max(0, netOutageMinutes - vendorCoveredMinutes);
  const sumRawVendorOverlapMinutes = rawRows.reduce((acc, r) => acc + r.overlapMinutes, 0);

  if (netOutageMinutes <= 0 || newCreditCents <= 0) {
    const zeroRows: VendorApportionmentRow[] = rawRows.map((row) => ({
      ...row,
      shareBps:
        netOutageMinutes > 0 && sumRawVendorOverlapMinutes > 0
          ? Math.round(
              ((row.overlapMinutes * vendorCoveredMinutes) /
                (sumRawVendorOverlapMinutes * netOutageMinutes)) *
                10000,
            )
          : 0,
      exactCents: 0,
      apportionedCents: 0,
      remainderFraction: 0,
    }));
    return {
      vendorApportionments: zeroRows,
      vendorCoveredMinutes,
      vendorTotalApportionedCents: 0,
      internalAbsorbedMinutes,
      internalAbsorbedCents: Math.max(0, newCreditCents),
    };
  }

  if (sumRawVendorOverlapMinutes <= 0 || vendorCoveredMinutes <= 0) {
    const zeroVendorRows: VendorApportionmentRow[] = rawRows.map((row) => ({
      ...row,
      shareBps: 0,
      exactCents: 0,
      apportionedCents: 0,
      remainderFraction: 0,
    }));
    return {
      vendorApportionments: zeroVendorRows,
      vendorCoveredMinutes: 0,
      vendorTotalApportionedCents: 0,
      internalAbsorbedMinutes: netOutageMinutes,
      internalAbsorbedCents: newCreditCents,
    };
  }

  // Exact rational weight denominator:
  // Each vendor i gets numerator: overlapMinutes_i * vendorCoveredMinutes
  // Internal gets numerator: internalAbsorbedMinutes * sumRawVendorOverlapMinutes
  // Total denominator: netOutageMinutes * sumRawVendorOverlapMinutes
  // Notice sum(vendor numerators) + internal numerator === (vendorCoveredMinutes + internalAbsorbedMinutes) * sumRawVendorOverlapMinutes === totalDenominator.
  const totalDenominator = BigInt(netOutageMinutes) * BigInt(sumRawVendorOverlapMinutes);
  const creditBig = BigInt(newCreditCents);

  interface Bucket {
    kind: 'vendor' | 'internal';
    index: number;
    weightNumerator: bigint;
    floorCents: number;
    remainderNumerator: bigint;
    exactCents: number;
    remainderFraction: number;
    shareBps: number;
  }

  const buckets: Bucket[] = rawRows.map((row, idx) => {
    const weightNumerator = BigInt(row.overlapMinutes) * BigInt(vendorCoveredMinutes);
    const scaled = weightNumerator * creditBig;
    const floorBig = scaled / totalDenominator;
    const remBig = scaled % totalDenominator;
    const shareFloat = Number(weightNumerator) / Number(totalDenominator);
    const exactCents = Number((shareFloat * newCreditCents).toFixed(4));
    const remainderFraction = Number((Number(remBig) / Number(totalDenominator)).toFixed(6));
    const shareBps = Math.round(shareFloat * 10000);

    return {
      kind: 'vendor',
      index: idx,
      weightNumerator,
      floorCents: Number(floorBig),
      remainderNumerator: remBig,
      exactCents,
      remainderFraction,
      shareBps,
    };
  });

  const internalWeightNumerator =
    BigInt(internalAbsorbedMinutes) * BigInt(sumRawVendorOverlapMinutes);
  const internalScaled = internalWeightNumerator * creditBig;
  const internalFloorBig = internalScaled / totalDenominator;
  const internalRemBig = internalScaled % totalDenominator;
  const internalShareFloat = Number(internalWeightNumerator) / Number(totalDenominator);

  buckets.push({
    kind: 'internal',
    index: rawRows.length,
    weightNumerator: internalWeightNumerator,
    floorCents: Number(internalFloorBig),
    remainderNumerator: internalRemBig,
    exactCents: Number((internalShareFloat * newCreditCents).toFixed(4)),
    remainderFraction: Number((Number(internalRemBig) / Number(totalDenominator)).toFixed(6)),
    shareBps: Math.round(internalShareFloat * 10000),
  });

  const floorSum = buckets.reduce((acc, b) => acc + b.floorCents, 0);
  let remainderCentsToDistribute = Math.max(0, newCreditCents - floorSum);

  const rankedForRemainder = [...buckets].sort((a, b) => {
    if (b.remainderNumerator !== a.remainderNumerator) {
      return b.remainderNumerator > a.remainderNumerator ? 1 : -1;
    }
    return a.index - b.index;
  });

  const bonusByIndex = new Map<number, number>();
  for (const bucket of rankedForRemainder) {
    if (remainderCentsToDistribute <= 0) {
      break;
    }
    if (bucket.weightNumerator > 0n) {
      bonusByIndex.set(bucket.index, (bonusByIndex.get(bucket.index) ?? 0) + 1);
      remainderCentsToDistribute -= 1;
    }
  }

  const vendorApportionments: VendorApportionmentRow[] = rawRows.map((row, idx) => {
    const bucket = buckets[idx]!;
    const apportionedCents = bucket.floorCents + (bonusByIndex.get(idx) ?? 0);
    return {
      ...row,
      shareBps: bucket.shareBps,
      exactCents: bucket.exactCents,
      apportionedCents,
      remainderFraction: bucket.remainderFraction,
    };
  });

  const internalBucket = buckets[rawRows.length]!;
  const internalAbsorbedCents =
    internalBucket.floorCents + (bonusByIndex.get(rawRows.length) ?? 0);
  const vendorTotalApportionedCents = vendorApportionments.reduce(
    (acc, row) => acc + row.apportionedCents,
    0,
  );

  return {
    vendorApportionments,
    vendorCoveredMinutes,
    vendorTotalApportionedCents,
    internalAbsorbedMinutes,
    internalAbsorbedCents,
  };
}

export function formatMachineReadableFooter(receipt: CalculationReceipt): string {
  const modeLabel = receipt.provenance.sourceMode === 'LIVE_GRAPH_AND_REST' ? 'LIVE' : 'SEEDED';
  const creditDollars = (receipt.mathBreakdown.newCreditCents / 100).toFixed(2);
  const vendorDollars = (receipt.mathBreakdown.vendorTotalApportionedCents / 100).toFixed(2);
  const internalDollars = (receipt.mathBreakdown.internalAbsorbedCents / 100).toFixed(2);
  return `[ClauseClock Receipt #${receipt.receiptId} | issue=${receipt.claimKey} | month=${receipt.billingMonth} (${receipt.billingTimezone}) | mode=${modeLabel} | netOutage=${receipt.mathBreakdown.netOutageMinutes}m | credit=$${creditDollars} | vendorSplit=$${vendorDollars} vendor / $${internalDollars} internal]`;
}

function buildMarkdownExports(params: {
  receiptId: string;
  proposalVersionKey: string;
  scenario: ClauseClockScenario;
  billingTimezone: string;
  mathBreakdown: CalculationReceipt['mathBreakdown'];
  vendorApportionments: readonly VendorApportionmentRow[];
  naiveComparison: NaiveSpreadsheetComparison;
}): MarkdownExports {
  const {
    receiptId,
    proposalVersionKey,
    scenario,
    billingTimezone,
    mathBreakdown,
    vendorApportionments,
    naiveComparison,
  } = params;
  const contract = scenario.contract;
  const formatUsd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

  const customerCreditReceiptMd = [
    `### ClauseClock Customer Service Credit Receipt (${receiptId})`,
    `- **Claim Issue**: \`${contract.claimKey}\` · **Customer**: ${contract.customerName} (\`${contract.customerId}\`)`,
    `- **Billing Window**: \`${contract.billingMonth}\` (\`${billingTimezone}\`, ${contract.billingMonthTotalMinutes} total minutes)`,
    `- **Proposal Version Key**: \`${proposalVersionKey}\``,
    `- **Interval Splicing**: Raw Incidents \`${mathBreakdown.rawIncidentMinutes}m\` -> Merged Union \`${mathBreakdown.mergedIncidentMinutes}m\` -> Maintenance Deducted \`${mathBreakdown.maintenanceDeductedMinutes}m\` -> **Net Outage \`${mathBreakdown.netOutageMinutes}m\`**`,
    `- **Monthly Uptime & Matched Tier**: \`${mathBreakdown.uptimePercentage.toFixed(4)}%\` -> \`${mathBreakdown.matchedTier.label}\` (\`${mathBreakdown.matchedTier.creditBps / 100}%\`)`,
    `- **Credit Settlement**: Gross \`${formatUsd(mathBreakdown.grossCreditCents)}\` | Prior Approved \`${formatUsd(mathBreakdown.priorApprovedCents)}\` | Remaining Monthly Cap \`${formatUsd(mathBreakdown.remainingCapBeforeCents)}\` -> **Net Credit \`${formatUsd(mathBreakdown.newCreditCents)}\`**`,
    `- **Spreadsheet Overcharge Prevented**: \`${formatUsd(naiveComparison.overchargePreventedCents)}\` (Naive \`${naiveComparison.rawIncidentSumMinutes}m\` = \`${formatUsd(naiveComparison.naiveCreditCents)}\`)`,
  ].join('\n');

  const vendorLines =
    vendorApportionments.length === 0
      ? ['| _None_ | _N/A_ | 0m | 0.00% | $0.00 |']
      : vendorApportionments.map(
          (v) =>
            `| \`${v.vendorId}\` (${v.vendorName}) | \`${v.componentKey}\` | ${v.overlapMinutes}m | ${(v.shareBps / 100).toFixed(2)}% | ${formatUsd(v.apportionedCents)} |`,
        );

  const vendorRecoveryClaimMd = [
    `### ClauseClock Upstream Vendor Recovery Apportionment (${contract.claimKey})`,
    `- **Proposal Version Key**: \`${proposalVersionKey}\``,
    `- **Customer Net Outage**: \`${mathBreakdown.netOutageMinutes}m\` · **Net Credit Liability**: \`${formatUsd(mathBreakdown.newCreditCents)}\``,
    `- **Vendor Recovery Total**: \`${formatUsd(mathBreakdown.vendorTotalApportionedCents)}\` (${mathBreakdown.vendorCoveredMinutes}m) · **Internal Absorption**: \`${formatUsd(mathBreakdown.internalAbsorbedCents)}\` (${mathBreakdown.internalAbsorbedMinutes}m)`,
    '',
    '| Vendor | Component | Overlap | Share | Apportioned Recovery |',
    '| --- | --- | --- | --- | --- |',
    ...vendorLines,
  ].join('\n');

  const confluenceLedgerRowMd = `| ${contract.claimKey} | ${contract.customerName} | ${contract.billingMonth} (${billingTimezone}) | ${mathBreakdown.netOutageMinutes}m (${mathBreakdown.uptimePercentage.toFixed(4)}%) | ${formatUsd(mathBreakdown.newCreditCents)} | ${formatUsd(mathBreakdown.vendorTotalApportionedCents)} vendor / ${formatUsd(mathBreakdown.internalAbsorbedCents)} internal | \`${proposalVersionKey}\` |`;

  return {
    customerCreditReceiptMd,
    vendorRecoveryClaimMd,
    confluenceLedgerRowMd,
  };
}

export function reconcileClauseClock(
  scenario: ClauseClockScenario,
  options?: ReconcileOptions,
): CalculationReceipt {
  const contract = scenario.contract;
  const billingMonthTotalMinutes = Math.max(
    1,
    Math.min(MAX_BILLING_MONTH_MINUTES, Math.floor(contract.billingMonthTotalMinutes)),
  );

  const rawContractTimezone = contract.billingTimezone?.trim();
  const overrideTimezone = options?.timezoneOverride?.trim();
  const missingTimezoneFallback = !rawContractTimezone && !overrideTimezone;
  const billingTimezone = overrideTimezone || rawContractTimezone || 'UTC';
  const baseTimezone = rawContractTimezone || 'UTC';
  const shiftMinutes =
    resolveTimezoneOffsetMinutes(baseTimezone) - resolveTimezoneOffsetMinutes(billingTimezone);

  const disabledIncidentSet = new Set(options?.disabledIncidentIds ?? []);
  const disabledMaintenanceSet = new Set(options?.disabledMaintenanceIds ?? []);

  const activeRawIncidents = scenario.incidents
    .filter((inc) => inc.included !== false && !disabledIncidentSet.has(inc.id))
    .map((inc) => ({ ...inc, included: true }));

  const activeRawMaintenance = scenario.maintenanceWindows
    .filter((maint) => maint.included !== false && !disabledMaintenanceSet.has(maint.id))
    .map((maint) => ({ ...maint, included: true }));

  const clippedIncidentsResult = clipIntervalsToWindow(
    activeRawIncidents,
    0,
    billingMonthTotalMinutes,
    shiftMinutes,
  );
  const clippedMaintenanceResult = clipIntervalsToWindow(
    activeRawMaintenance,
    0,
    billingMonthTotalMinutes,
    shiftMinutes,
  );

  const boundaryClippedCount =
    clippedIncidentsResult.clippedCount + clippedMaintenanceResult.clippedCount;

  const mergedIncidents = mergeIntervals(clippedIncidentsResult.clippedIntervals);
  const mergedMaintenance = mergeIntervals(clippedMaintenanceResult.clippedIntervals);
  const subtraction = subtractIntervals(mergedIncidents, mergedMaintenance);
  const netOutageIntervals = subtraction.remainingIntervals;
  const maintenanceDeductedSlices = subtraction.deductedSlices;

  const rawIncidentMinutes = sumIntervalMinutes(clippedIncidentsResult.clippedIntervals);
  const mergedIncidentMinutes = sumIntervalMinutes(mergedIncidents);
  const maintenanceDeductedMinutes = sumIntervalMinutes(maintenanceDeductedSlices);
  const netOutageMinutes = sumIntervalMinutes(netOutageIntervals);

  // Guard against AI override attempts: strictly use locked contract integers
  const discardedAiAmountOverrides: string[] = [];
  if (options?.aiOverrideAttempt) {
    const attempt = options.aiOverrideAttempt;
    if (
      attempt.monthlyFeeCents !== undefined &&
      attempt.monthlyFeeCents !== contract.monthlyFeeCents
    ) {
      discardedAiAmountOverrides.push(
        `Discarded AI override monthlyFeeCents=${attempt.monthlyFeeCents} (locked contract monthlyFeeCents=${contract.monthlyFeeCents})`,
      );
    }
    if (attempt.newCreditCents !== undefined) {
      discardedAiAmountOverrides.push(
        `Discarded AI override newCreditCents=${attempt.newCreditCents} (computed deterministically from contract SLA tiers)`,
      );
    }
    if (attempt.creditBps !== undefined) {
      discardedAiAmountOverrides.push(
        `Discarded AI override creditBps=${attempt.creditBps} (locked to contract slaTiers)`,
      );
    }
  }

  const lockedMonthlyFeeCents = Math.max(0, Math.floor(contract.monthlyFeeCents));
  const lockedMonthlyCapCents = Math.max(0, Math.floor(contract.monthlyCapCents));
  const lockedPriorApprovedCents = Math.max(0, Math.floor(contract.priorApprovedCents));
  const remainingCapBeforeCents = Math.max(0, lockedMonthlyCapCents - lockedPriorApprovedCents);

  const { uptimePercentage, uptimeBps, matchedTier } = matchSlaCreditTier(
    contract.slaTiers,
    netOutageMinutes,
    billingMonthTotalMinutes,
  );

  const grossCreditCents = Math.round((lockedMonthlyFeeCents * matchedTier.creditBps) / 10000);

  // Credit cap & prior-approved reconciliation:
  // - If grossCreditCents exceeds remainingCapBeforeCents, the monthly cap is the binding ceiling
  //   (capTruncated = grossCreditCents > 0, newCreditCents = remainingCapBeforeCents).
  // - Otherwise, priorApprovedCents is netted against grossCreditCents without exceeding remainingCapBeforeCents.
  const capTruncated = grossCreditCents > 0 && grossCreditCents > remainingCapBeforeCents;
  const uncappedAvailableCreditCents = capTruncated
    ? grossCreditCents
    : Math.max(0, grossCreditCents - lockedPriorApprovedCents);
  const newCreditCents = capTruncated
    ? remainingCapBeforeCents
    : Math.min(uncappedAvailableCreditCents, remainingCapBeforeCents);
  const remainingCapAfterCents = Math.max(0, remainingCapBeforeCents - newCreditCents);

  const {
    vendorApportionments,
    vendorCoveredMinutes,
    vendorTotalApportionedCents,
    internalAbsorbedMinutes,
    internalAbsorbedCents,
  } = apportionVendorAndInternalCents({
    vendorFeeds: scenario.vendorFeeds,
    netOutageIntervals,
    netOutageMinutes,
    newCreditCents,
    windowStartMinute: 0,
    windowEndMinute: billingMonthTotalMinutes,
    shiftMinutes,
  });

  // Naive spreadsheet comparison: raw sum of unclipped active incident durations, no maintenance deduction, no prior-approved netting
  const unclippedRawIncidentSumMinutes = sumIntervalMinutes(activeRawIncidents);
  const naiveTierMatch = matchSlaCreditTier(
    contract.slaTiers,
    unclippedRawIncidentSumMinutes,
    billingMonthTotalMinutes,
  );
  const naiveCreditCents = Math.round(
    (lockedMonthlyFeeCents * naiveTierMatch.matchedTier.creditBps) / 10000,
  );
  const naiveComparison: NaiveSpreadsheetComparison = {
    rawIncidentSumMinutes: unclippedRawIncidentSumMinutes,
    naiveUptimePct: naiveTierMatch.uptimePercentage,
    naiveTierLabel: naiveTierMatch.matchedTier.label,
    naiveCreditBps: naiveTierMatch.matchedTier.creditBps,
    naiveCreditCents,
    overchargePreventedCents: Math.max(0, naiveCreditCents - newCreditCents),
    overcountedMinutes: Math.max(0, unclippedRawIncidentSumMinutes - netOutageMinutes),
  };

  const proposalVersionKey = `CCLOCK-${contract.claimKey}-${contract.billingMonth}-NET${netOutageMinutes}M-CRED${newCreditCents}-VEND${vendorTotalApportionedCents}`;
  const receiptId = `RCPT-${contract.claimKey}-${contract.billingMonth}-NET${netOutageMinutes}M`;
  const provisionalDraftMode = contract.contractStatus === 'DRAFT';
  const sourceMode = options?.sourceMode ?? scenario.sourceMode ?? 'SEEDED_FIXTURE';
  const fallbackReason = options?.fallbackReason ?? scenario.fallbackReason ?? null;

  const provenance: SourceProvenanceManifest = {
    sourceMode,
    fallbackReason,
    claimKey: contract.claimKey,
    contractId: contract.contractId,
    confluenceContractUrl: contract.confluenceContractUrl,
    billingTimezoneResolved: billingTimezone,
    missingTimezoneFallback,
    provisionalDraftMode,
    evaluatedIncidentKeys: activeRawIncidents.map((i) => i.sourceKey ?? i.id),
    evaluatedMaintenanceKeys: activeRawMaintenance.map((m) => m.sourceKey ?? m.id),
    evaluatedVendorKeys: scenario.vendorFeeds.map((v) => v.vendorId),
  };

  const mathBreakdown: CalculationReceipt['mathBreakdown'] = {
    rawIncidentMinutes,
    mergedIncidentMinutes,
    maintenanceDeductedMinutes,
    netOutageMinutes,
    uptimePercentage,
    uptimeBps,
    matchedTier,
    grossCreditCents,
    priorApprovedCents: lockedPriorApprovedCents,
    remainingCapBeforeCents,
    uncappedAvailableCreditCents,
    capTruncated,
    newCreditCents,
    remainingCapAfterCents,
    vendorCoveredMinutes,
    vendorTotalApportionedCents,
    internalAbsorbedMinutes,
    internalAbsorbedCents,
  };

  const markdownExports = buildMarkdownExports({
    receiptId,
    proposalVersionKey,
    scenario,
    billingTimezone,
    mathBreakdown,
    vendorApportionments,
    naiveComparison,
  });

  const replayCommand = `npx tsx -e "import { getSeededScenario, reconcileClauseClock } from './src/core/index.ts'; console.log(JSON.stringify(reconcileClauseClock(getSeededScenario('${scenario.scenarioId}'), { timezoneOverride: '${billingTimezone}' })))"`;

  const receiptWithoutFooter: CalculationReceipt = {
    receiptId,
    proposalVersionKey,
    scenarioId: scenario.scenarioId,
    claimKey: contract.claimKey,
    customerId: contract.customerId,
    customerName: contract.customerName,
    billingMonth: contract.billingMonth,
    billingTimezone,
    missingTimezoneFallback,
    boundaryClippedCount,
    provisionalDraftMode,
    inputsSnapshot: {
      billingMonthTotalMinutes,
      monthlyFeeCents: lockedMonthlyFeeCents,
      monthlyCapCents: lockedMonthlyCapCents,
      priorApprovedCents: lockedPriorApprovedCents,
      remainingCapBeforeCents,
    },
    intervalLedger: {
      rawIncidents: activeRawIncidents,
      clippedIncidents: clippedIncidentsResult.clippedIntervals,
      mergedIncidents,
      clippedMaintenance: clippedMaintenanceResult.clippedIntervals,
      mergedMaintenance,
      maintenanceDeductedSlices,
      netOutageIntervals,
    },
    mathBreakdown,
    vendorApportionments,
    naiveComparison,
    discardedAiAmountOverrides,
    provenance,
    markdownExports,
    machineReadableFooter: '',
    replayCommand,
  };

  return {
    ...receiptWithoutFooter,
    machineReadableFooter: formatMachineReadableFooter(receiptWithoutFooter),
  };
}
