import { resolveTimezoneOffsetMinutes } from '../../src/core/clause-clock-engine.ts';
import type {
  CalculationReceipt,
  ClauseClockScenario,
  HalfOpenInterval,
} from '../../src/core/clause-clock-types.ts';
import { billingClockParts, formatMinutes } from './format.ts';

export type WaterfallTrackId =
  | 'raw-incidents'
  | 'merged-union'
  | 'maintenance-deduction'
  | 'net-outage'
  | 'vendor-overlap';

export type WaterfallTone = 'raw' | 'union' | 'deduction' | 'net' | 'vendor';

export interface WaterfallBar {
  key: string;
  label: string;
  startMinute: number;
  endMinute: number;
  leftPct: number;
  widthPct: number;
  vendorIndex: number | null;
  row: number;
}

export interface WaterfallTrack {
  id: WaterfallTrackId;
  numeral: string;
  title: string;
  operator: string;
  tone: WaterfallTone;
  totalMinutes: number;
  totalLabel: string;
  rowCount: number;
  segments: WaterfallBar[];
  ghosts: WaterfallBar[];
}

export interface WaterfallTick {
  minute: number;
  leftPct: number;
  label: string;
  dayLabel: string | null;
}

export interface IntervalWaterfallModel {
  domainStartMinute: number;
  domainEndMinute: number;
  monthStartPct: number | null;
  ticks: WaterfallTick[];
  tracks: WaterfallTrack[];
}

const TICK_STEPS = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440] as const;
const MAX_TICKS = 8;

function shiftInterval(interval: HalfOpenInterval, shiftMinutes: number): HalfOpenInterval {
  return {
    ...interval,
    startMinute: Math.floor(interval.startMinute) + shiftMinutes,
    endMinute: Math.floor(interval.endMinute) + shiftMinutes,
  };
}

function pickTickStep(spanMinutes: number): number {
  return TICK_STEPS.find((step) => spanMinutes / step <= MAX_TICKS) ?? TICK_STEPS[TICK_STEPS.length - 1];
}

// Overlapping bars would hide each other in one lane, which is exactly the overlap the waterfall exists to show,
// so each lane greedily packs bars into the fewest stacked rows.
function packRows(bars: readonly WaterfallBar[]): { segments: WaterfallBar[]; rowCount: number } {
  const rowEnds: number[] = [];
  const segments = [...bars]
    .sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute)
    .map((bar) => {
      const freeRow = rowEnds.findIndex((end) => end <= bar.startMinute);
      const row = freeRow === -1 ? rowEnds.length : freeRow;
      rowEnds[row] = bar.endMinute;
      return { ...bar, row };
    });
  return { segments, rowCount: Math.max(1, rowEnds.length) };
}

// The engine shifts every window by contract-offset minus billing-offset before clipping; the raw and ghost lanes
// replay that shift so they line up with the clipped ledger slices the receipt already carries.
export function buildIntervalWaterfall(
  scenario: ClauseClockScenario,
  receipt: CalculationReceipt,
): IntervalWaterfallModel {
  const contractTimezone = scenario.contract.billingTimezone?.trim() || 'UTC';
  const shiftMinutes =
    resolveTimezoneOffsetMinutes(contractTimezone) - resolveTimezoneOffsetMinutes(receipt.billingTimezone);
  const ledger = receipt.intervalLedger;
  const math = receipt.mathBreakdown;

  const rawIncidents = ledger.rawIncidents.map((interval) => shiftInterval(interval, shiftMinutes));
  const maintenanceWindows = scenario.maintenanceWindows.map((interval) => shiftInterval(interval, shiftMinutes));
  const vendorWindows = scenario.vendorFeeds.flatMap((feed, vendorIndex) =>
    feed.intervals.map((interval) => ({ vendorIndex, interval: shiftInterval(interval, shiftMinutes) })),
  );

  const extents = [
    ...rawIncidents,
    ...maintenanceWindows,
    ...vendorWindows.map((entry) => entry.interval),
    ...ledger.mergedIncidents,
  ];
  const lowest = extents.length > 0 ? Math.min(...extents.map((interval) => interval.startMinute)) : 0;
  const highest = extents.length > 0 ? Math.max(...extents.map((interval) => interval.endMinute)) : 60;
  const padding = Math.max(15, Math.round((highest - lowest) * 0.08));
  const step = pickTickStep(highest - lowest + padding * 2);
  const domainStartMinute = Math.floor((lowest - padding) / step) * step;
  const domainEndMinute = Math.ceil((highest + padding) / step) * step;
  const span = Math.max(1, domainEndMinute - domainStartMinute);
  const toPct = (minute: number): number => ((minute - domainStartMinute) / span) * 100;

  const toBar = (
    interval: HalfOpenInterval,
    keyPrefix: string,
    vendorIndex: number | null = null,
  ): WaterfallBar => ({
    key: `${keyPrefix}:${interval.id}:${interval.startMinute}-${interval.endMinute}`,
    label: interval.label,
    startMinute: interval.startMinute,
    endMinute: interval.endMinute,
    leftPct: toPct(interval.startMinute),
    widthPct: ((interval.endMinute - interval.startMinute) / span) * 100,
    vendorIndex,
    row: 0,
  });

  const ticks: WaterfallTick[] = [];
  let previousDay: string | null = null;
  for (let minute = domainStartMinute; minute <= domainEndMinute; minute += step) {
    const parts = billingClockParts(receipt.billingMonth, minute);
    ticks.push({
      minute,
      leftPct: toPct(minute),
      label: parts.time,
      dayLabel: parts.monthDay !== previousDay ? parts.monthDay : null,
    });
    previousDay = parts.monthDay;
  }

  const track = (
    spec: Omit<WaterfallTrack, 'segments' | 'rowCount'>,
    bars: readonly WaterfallBar[],
  ): WaterfallTrack => ({ ...spec, ...packRows(bars) });

  const tracks: WaterfallTrack[] = [
    track(
      {
        id: 'raw-incidents',
        numeral: 'I',
        title: 'Raw Incidents',
        operator: 'Σ as reported',
        tone: 'raw',
        totalMinutes: receipt.naiveComparison.rawIncidentSumMinutes,
        totalLabel: formatMinutes(receipt.naiveComparison.rawIncidentSumMinutes),
        ghosts: [],
      },
      rawIncidents.map((interval) => toBar(interval, 'raw')),
    ),
    track(
      {
        id: 'merged-union',
        numeral: 'II',
        title: 'Merged Union',
        operator: '∪ overlaps folded',
        tone: 'union',
        totalMinutes: math.mergedIncidentMinutes,
        totalLabel: formatMinutes(math.mergedIncidentMinutes),
        ghosts: [],
      },
      ledger.mergedIncidents.map((interval) => toBar(interval, 'union')),
    ),
    track(
      {
        id: 'maintenance-deduction',
        numeral: 'III',
        title: 'Maintenance Deduction',
        operator: '∖ scheduled change',
        tone: 'deduction',
        totalMinutes: math.maintenanceDeductedMinutes,
        totalLabel:
          math.maintenanceDeductedMinutes > 0
            ? `−${formatMinutes(math.maintenanceDeductedMinutes)}`
            : formatMinutes(0),
        ghosts: maintenanceWindows.map((interval) => toBar(interval, 'maintenance')),
      },
      ledger.maintenanceDeductedSlices.map((interval) => toBar(interval, 'deducted')),
    ),
    track(
      {
        id: 'net-outage',
        numeral: 'IV',
        title: 'Customer Net Outage',
        operator: '= billable minutes',
        tone: 'net',
        totalMinutes: math.netOutageMinutes,
        totalLabel: formatMinutes(math.netOutageMinutes),
        ghosts: [],
      },
      ledger.netOutageIntervals.map((interval) => toBar(interval, 'net')),
    ),
    track(
      {
        id: 'vendor-overlap',
        numeral: 'V',
        title: 'Vendor Overlap Slices',
        operator: '∩ upstream windows',
        tone: 'vendor',
        totalMinutes: math.vendorCoveredMinutes,
        totalLabel: formatMinutes(math.vendorCoveredMinutes),
        ghosts: vendorWindows.map((entry) => toBar(entry.interval, 'vendor-window', entry.vendorIndex)),
      },
      receipt.vendorApportionments.flatMap((vendor, vendorIndex) =>
        vendor.overlapIntervals.map((interval) =>
          toBar({ ...interval, label: vendor.vendorName }, `vendor-${vendor.vendorId}`, vendorIndex),
        ),
      ),
    ),
  ];

  return {
    domainStartMinute,
    domainEndMinute,
    monthStartPct: domainStartMinute < 0 && domainEndMinute > 0 ? toPct(0) : null,
    ticks,
    tracks,
  };
}
