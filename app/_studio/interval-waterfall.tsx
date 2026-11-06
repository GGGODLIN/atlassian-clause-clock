'use client';

import type { CalculationReceipt } from '../../src/core/clause-clock-types.ts';
import { formatBillingRange, formatMinutes, formatUsdCents } from './format.ts';
import type { IntervalWaterfallModel, WaterfallBar, WaterfallTrack } from './waterfall-model.ts';

const TONE_CLASSES: Record<WaterfallTrack['tone'], string> = {
  raw: 'cc-bar-raw',
  union: 'cc-bar-union',
  deduction: 'cc-bar-deduction',
  net: 'cc-bar-net',
  vendor: '',
};

const GHOST_CLASSES: Record<WaterfallTrack['tone'], string> = {
  raw: 'cc-ghost cc-ghost-excluded',
  union: 'cc-ghost',
  deduction: 'cc-ghost cc-ghost-deduction',
  net: 'cc-ghost',
  vendor: 'cc-ghost cc-ghost-vendor',
};

function segmentClass(track: WaterfallTrack, bar: WaterfallBar): string {
  if (track.tone === 'vendor') {
    return `cc-bar-vendor-${(bar.vendorIndex ?? 0) % 3}`;
  }
  return TONE_CLASSES[track.tone];
}

const TRACK_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 @3xl:grid-cols-[13.5rem_minmax(0,1fr)_6rem]';

const LANE_PADDING_PX = 6;

function laneHeightRem(rowCount: number): number {
  return 2.5 + (rowCount - 1) * 1;
}

function rowPlacement(row: number, rowCount: number): { top: string; height: string } {
  const usable = `(100% - ${LANE_PADDING_PX * 2}px)`;
  return {
    top: `calc(${LANE_PADDING_PX}px + ${usable} * ${row} / ${rowCount})`,
    height: `calc(${usable} / ${rowCount} - ${rowCount > 1 ? 2 : 0}px)`,
  };
}

interface NaiveComparisonProps {
  receipt: CalculationReceipt;
}

function NaiveSpreadsheetComparison({ receipt }: NaiveComparisonProps) {
  const naive = receipt.naiveComparison;
  const math = receipt.mathBreakdown;
  return (
    <div
      data-testid="naive-spreadsheet-comparison"
      data-naive-minutes={naive.rawIncidentSumMinutes}
      data-naive-credit-cents={naive.naiveCreditCents}
      data-clauseclock-minutes={math.netOutageMinutes}
      data-clauseclock-credit-cents={math.newCreditCents}
      className="mt-6 grid gap-3 border-t border-case-rule pt-5 @3xl:grid-cols-[1fr_auto_1fr]"
    >
      <div className="rounded-xl border border-signal/40 bg-signal/5 p-4">
        <p className="cc-eyebrow text-signal">Naive spreadsheet</p>
        <p className="mt-2 font-mono text-xs text-case-muted">=SUM(incident durations) · no fold · no maintenance</p>
        <p className="mt-2 font-display text-3xl text-case-text/70 line-through decoration-signal decoration-2">
          {formatMinutes(naive.rawIncidentSumMinutes)} → {formatUsdCents(naive.naiveCreditCents)}
        </p>
        <p className="mt-1 font-mono text-[11px] text-case-muted">
          {naive.naiveUptimePct.toFixed(4)}% uptime · {naive.naiveTierLabel}
        </p>
      </div>
      <div className="flex flex-col items-center justify-center px-2 text-center">
        <span className="cc-eyebrow text-[10px] text-case-muted">overcharge prevented</span>
        <span className="font-display text-4xl italic leading-tight text-signal">
          {formatUsdCents(naive.overchargePreventedCents)}
        </span>
        <span className="font-mono text-[11px] text-case-muted">{formatMinutes(naive.overcountedMinutes)} over-counted</span>
      </div>
      <div className="rounded-xl border border-lume/40 bg-lume/5 p-4">
        <p className="cc-eyebrow text-lume">ClauseClock</p>
        <p className="mt-2 font-mono text-xs text-case-muted">(∪ incidents ∩ billing month) ∖ ∪ maintenance</p>
        <p className="mt-2 font-display text-3xl text-case-text">
          {formatMinutes(math.netOutageMinutes)} → {formatUsdCents(math.newCreditCents)}
        </p>
        <p className="mt-1 font-mono text-[11px] text-case-muted">
          {math.uptimePercentage.toFixed(4)}% uptime · {math.matchedTier.label}
        </p>
      </div>
    </div>
  );
}

export interface IntervalWaterfallProps {
  model: IntervalWaterfallModel;
  receipt: CalculationReceipt;
  provisionalDraft: boolean;
}

export function IntervalWaterfall({ model, receipt, provisionalDraft }: IntervalWaterfallProps) {
  const describe = (bar: WaterfallBar): string =>
    `${bar.label} · ${formatBillingRange(receipt.billingMonth, bar.startMinute, bar.endMinute)} (${formatMinutes(bar.endMinute - bar.startMinute)})`;

  return (
    <section
      data-testid="interval-waterfall"
      aria-labelledby="cc-waterfall-heading"
      className="cc-case cc-rise relative isolate overflow-hidden rounded-[2rem] p-5 @3xl:p-7"
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="cc-eyebrow text-brass">Movement · integer-minute sweep line</p>
          <h2 id="cc-waterfall-heading" className="mt-1 font-display text-3xl leading-none text-case-text @3xl:text-4xl">
            5-Track Interval Waterfall
          </h2>
        </div>
        <p className="font-mono text-[11px] text-case-muted">
          billing clock · {receipt.billingMonth} · {receipt.billingTimezone}
        </p>
      </header>

      <div className="mt-6">
        <div className={TRACK_GRID} aria-hidden>
          <span className="hidden @3xl:block" />
          <div className="relative col-span-2 h-8 @3xl:col-span-1">
            {model.ticks.map((tick) => (
              <span
                key={tick.minute}
                className="absolute bottom-0 flex -translate-x-1/2 flex-col items-center font-mono text-[10px] text-case-muted"
                style={{ left: `${tick.leftPct}%` }}
              >
                {tick.dayLabel ? <span className="text-brass">{tick.dayLabel}</span> : null}
                <span>{tick.label}</span>
              </span>
            ))}
          </div>
          <span className="hidden @3xl:block" />
        </div>

        <div className="mt-2 space-y-3">
          {model.tracks.map((track, trackPosition) => (
            <div
              key={track.id}
              data-testid="waterfall-track"
              data-track-id={track.id}
              data-total-minutes={track.totalMinutes}
              role="group"
              aria-label={`${track.numeral}. ${track.title}: ${track.totalLabel} across ${track.segments.length} slice(s)`}
              className={TRACK_GRID}
            >
              <div className="flex items-baseline gap-3">
                <span className="w-8 font-display text-2xl italic leading-none text-brass">{track.numeral}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-case-text">{track.title}</span>
                  <span className="block font-mono text-[11px] text-case-muted">{track.operator}</span>
                </span>
              </div>
              <div className="order-last col-span-2 @3xl:order-none @3xl:col-span-1">
                <div
                  className="cc-minute-track relative rounded-lg bg-case-3/70 ring-1 ring-case-rule"
                  style={{ height: `${laneHeightRem(track.rowCount)}rem` }}
                >
                  {model.ticks.map((tick) => (
                    <span
                      key={tick.minute}
                      aria-hidden
                      className="absolute inset-y-0 w-px bg-case-text/10"
                      style={{ left: `${tick.leftPct}%` }}
                    />
                  ))}
                  {model.monthStartPct !== null ? (
                    <span
                      aria-hidden
                      className="absolute -inset-y-1.5 z-10 w-0 border-l border-dashed border-signal"
                      style={{ left: `${model.monthStartPct}%` }}
                    />
                  ) : null}
                  {track.ghosts.map((ghost) => (
                    <span
                      key={ghost.key}
                      aria-hidden
                      title={describe(ghost)}
                      className={`absolute inset-y-1 rounded-[4px] ${GHOST_CLASSES[track.tone]}`}
                      style={{ left: `${ghost.leftPct}%`, width: `${ghost.widthPct}%` }}
                    />
                  ))}
                  {track.segments.map((segment, segmentPosition) => (
                    <span
                      key={`${receipt.proposalVersionKey}:${segment.key}`}
                      data-testid="waterfall-segment"
                      data-start-minute={segment.startMinute}
                      data-end-minute={segment.endMinute}
                      title={describe(segment)}
                      className={`cc-draw absolute min-w-[3px] rounded-[3px] ${segmentClass(track, segment)}`}
                      style={{
                        ...rowPlacement(segment.row, track.rowCount),
                        left: `${segment.leftPct}%`,
                        width: `${segment.widthPct}%`,
                        animationDelay: `${trackPosition * 120 + segmentPosition * 70}ms`,
                      }}
                    />
                  ))}
                </div>
              </div>
              <p
                className={`text-right font-display text-3xl leading-none @3xl:text-4xl ${
                  track.tone === 'net' ? 'text-lume' : track.tone === 'deduction' ? 'text-signal' : 'text-case-text'
                }`}
              >
                {track.totalLabel}
              </p>
            </div>
          ))}
        </div>

        {model.monthStartPct !== null ? (
          <p className="mt-3 font-mono text-[11px] text-signal">
            ┆ dashed red rule = billing month opens ({receipt.billingMonth}-01 00:00 {receipt.billingTimezone}); hatched raw
            minutes left of it are clipped
          </p>
        ) : null}
      </div>

      <NaiveSpreadsheetComparison receipt={receipt} />

      {provisionalDraft ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
          <span className="cc-watermark text-[clamp(3rem,9vw,7.5rem)]">PROVISIONAL DRAFT</span>
        </div>
      ) : null}
    </section>
  );
}
