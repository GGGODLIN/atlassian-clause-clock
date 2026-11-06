'use client';

import type { CalculationReceipt } from '../../src/core/clause-clock-types.ts';
import { formatBps, formatMinutes, formatUsdCents } from './format.ts';

const SWEEP_START_DEG = -135;
const SWEEP_DEG = 270;
const TICK_STEP_DEG = 5;
const MAJOR_EVERY = 9;

interface TickLine {
  id: string;
  major: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function polar(radius: number, degrees: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  return { x: round2(60 + radius * Math.sin(radians)), y: round2(60 - radius * Math.cos(radians)) };
}

const DIAL_TICKS: readonly TickLine[] = Array.from({ length: SWEEP_DEG / TICK_STEP_DEG + 1 }, (_, step) => {
  const degrees = SWEEP_START_DEG + step * TICK_STEP_DEG;
  const major = step % MAJOR_EVERY === 0;
  const outer = polar(54, degrees);
  const inner = polar(major ? 45 : 50, degrees);
  return { id: `tick-${degrees}`, major, x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y };
});

function clampFraction(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

interface SubdialProps {
  label: string;
  value: string;
  caption: string;
  fraction: number;
  ghostFraction: number;
}

function Subdial({ label, value, caption, fraction, ghostFraction }: SubdialProps) {
  const handDeg = SWEEP_START_DEG + SWEEP_DEG * clampFraction(fraction);
  const ghostDeg = SWEEP_START_DEG + SWEEP_DEG * clampFraction(ghostFraction);
  return (
    <figure className="relative flex flex-col items-center">
      <svg viewBox="0 0 120 120" className="w-full max-w-[11.5rem]" aria-hidden>
        <circle cx="60" cy="60" r="58" className="fill-case stroke-case-rule" strokeWidth="1" />
        <circle cx="60" cy="60" r="41" className="fill-none stroke-case-rule" strokeWidth="0.6" />
        {DIAL_TICKS.map((tick) => (
          <line
            key={tick.id}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            className={tick.major ? 'stroke-case-text' : 'stroke-case-muted'}
            strokeWidth={tick.major ? 1.4 : 0.6}
          />
        ))}
        <g
          className="transition-transform duration-700 ease-out motion-reduce:transition-none"
          style={{ transform: `rotate(${round2(ghostDeg)}deg)`, transformOrigin: '60px 60px' }}
        >
          <line x1="60" y1="64" x2="60" y2="20" className="stroke-signal" strokeWidth="1.2" strokeDasharray="2 2" />
        </g>
        <g
          className="transition-transform duration-700 ease-out motion-reduce:transition-none"
          style={{ transform: `rotate(${round2(handDeg)}deg)`, transformOrigin: '60px 60px' }}
        >
          <line x1="60" y1="68" x2="60" y2="14" className="stroke-lume" strokeWidth="2.4" strokeLinecap="round" />
        </g>
        <circle cx="60" cy="60" r="3.6" className="fill-brass" />
      </svg>
      <figcaption className="-mt-8 flex flex-col items-center text-center">
        <span className="relative rounded-md bg-case px-2 py-1 font-display text-2xl leading-none text-case-text ring-1 ring-case-rule">
          {value}
        </span>
        <span className="cc-eyebrow mt-1 text-[10px] text-brass">{label}</span>
        <span className="mt-1 font-mono text-[10px] text-case-muted">{caption}</span>
      </figcaption>
    </figure>
  );
}

function niceMinuteScale(...minutes: number[]): number {
  return Math.max(60, Math.ceil(Math.max(...minutes) / 30) * 30);
}

export interface ChronographSubdialsProps {
  receipt: CalculationReceipt;
}

// The dashed red hand is the naive spreadsheet reading; the lume hand is ClauseClock's — the gap is the error prevented.
export function ChronographSubdials({ receipt }: ChronographSubdialsProps) {
  const math = receipt.mathBreakdown;
  const naive = receipt.naiveComparison;
  const minuteScale = niceMinuteScale(naive.rawIncidentSumMinutes, math.netOutageMinutes);
  const capCents = Math.max(1, receipt.inputsSnapshot.monthlyCapCents);

  return (
    <section aria-label="Chronograph complications" className="cc-case cc-rise rounded-[1.75rem] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="cc-eyebrow text-brass">Chronograph</h2>
        <p className="flex items-center gap-3 font-mono text-[10px] text-case-muted">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="w-4 border-t border-dashed border-signal" />
            spreadsheet
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4 bg-lume" />
            ClauseClock
          </span>
        </p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Subdial
          label="Net outage"
          value={formatMinutes(math.netOutageMinutes)}
          caption={`sheet ${formatMinutes(naive.rawIncidentSumMinutes)} / ${minuteScale}m`}
          fraction={math.netOutageMinutes / minuteScale}
          ghostFraction={naive.rawIncidentSumMinutes / minuteScale}
        />
        <Subdial
          label="Uptime"
          value={`${math.uptimePercentage.toFixed(3)}%`}
          caption={`${formatBps(math.matchedTier.creditBps)} tier · scale 99–100%`}
          fraction={math.uptimePercentage - 99}
          ghostFraction={naive.naiveUptimePct - 99}
        />
        <Subdial
          label="Credit"
          value={formatUsdCents(math.newCreditCents)}
          caption={`of ${formatUsdCents(capCents)} cap`}
          fraction={math.newCreditCents / capCents}
          ghostFraction={naive.naiveCreditCents / capCents}
        />
      </div>
    </section>
  );
}
