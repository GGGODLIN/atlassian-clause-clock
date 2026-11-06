'use client';

import type { CalculationReceipt } from '../../src/core/clause-clock-types.ts';
import type { WorkbenchErrorBanner } from './workbench-controller.ts';

const HOUR_MARKERS = Array.from({ length: 12 }, (_, hour) => {
  const radians = (hour * 30 * Math.PI) / 180;
  const round2 = (value: number) => Math.round(value * 100) / 100;
  return {
    id: `hour-${hour}`,
    x1: round2(24 + 15 * Math.sin(radians)),
    y1: round2(24 - 15 * Math.cos(radians)),
    x2: round2(24 + 19.5 * Math.sin(radians)),
    y2: round2(24 - 19.5 * Math.cos(radians)),
    major: hour % 3 === 0,
  };
});

function WatchMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-12 flex-none" aria-hidden>
      <circle cx="24" cy="24" r="23" className="fill-ink" />
      <circle cx="24" cy="24" r="21" className="fill-paper" />
      {HOUR_MARKERS.map((marker) => (
        <line
          key={marker.id}
          x1={marker.x1}
          y1={marker.y1}
          x2={marker.x2}
          y2={marker.y2}
          className="stroke-ink"
          strokeWidth={marker.major ? 2.2 : 1}
        />
      ))}
      <line x1="24" y1="24" x2="17" y2="15.5" className="stroke-ink" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="24" y1="24" x2="33.5" y2="11" className="stroke-ink" strokeWidth="1.8" strokeLinecap="round" />
      <g className="cc-seconds-hand">
        <line x1="24" y1="28" x2="24" y2="6.5" className="stroke-signal" strokeWidth="0.9" />
        <circle cx="24" cy="8.5" r="1.6" className="fill-signal" />
      </g>
      <circle cx="24" cy="24" r="1.4" className="fill-signal" />
    </svg>
  );
}

export function StudioHeader({ hostLabel }: { hostLabel: string }) {
  return (
    <header className="cc-rise flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-ink pb-5">
      <div className="flex items-center gap-4">
        <WatchMark />
        <div>
          <h1 className="font-display text-5xl italic leading-[0.9] tracking-tight @3xl:text-6xl">ClauseClock</h1>
          <p className="cc-eyebrow mt-2 text-steel">
            Calibre CC-26 · SLA interval splicer &amp; upstream vendor apportionment
          </p>
        </div>
      </div>
      <div className="flex flex-col items-start gap-1 @3xl:items-end">
        <p className="cc-eyebrow text-signal">Codegeist 2026 · Apps for Business Teams</p>
        <p className="rounded-full border border-ink/20 px-3 py-1 font-mono text-[11px] text-ink-soft">
          host · {hostLabel}
        </p>
      </div>
    </header>
  );
}

export function StudioCaseback({ receipt }: { receipt: CalculationReceipt }) {
  const provenance = receipt.provenance;
  return (
    <section
      aria-label="Proposal version key"
      className="cc-case cc-rise grid gap-x-8 gap-y-4 rounded-[1.75rem] px-5 py-4 @4xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] @3xl:px-7"
    >
      <div className="min-w-0">
        <p className="cc-eyebrow text-brass">Caseback · proposal version key bound to the human approval token</p>
        <p data-testid="proposal-version-key" className="mt-2 break-all font-mono text-base text-lume @3xl:text-lg">
          {receipt.proposalVersionKey}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-[11px]">
        <div>
          <dt className="text-case-muted">receipt</dt>
          <dd className="text-case-text">{receipt.receiptId}</dd>
        </div>
        <div>
          <dt className="text-case-muted">billing clock</dt>
          <dd className="text-case-text">
            {receipt.billingMonth} · {receipt.billingTimezone}
          </dd>
        </div>
        <div>
          <dt className="text-case-muted">source</dt>
          <dd className="text-case-text">{provenance.sourceMode}</dd>
        </div>
        <div>
          <dt className="text-case-muted">fallback</dt>
          <dd className="break-all text-case-text">{provenance.fallbackReason ?? 'none'}</dd>
        </div>
      </dl>
    </section>
  );
}

export interface StudioErrorBannerProps {
  banner: WorkbenchErrorBanner;
  onDismiss: () => void;
}

export function StudioErrorBanner({ banner, onDismiss }: StudioErrorBannerProps) {
  return (
    <div
      data-testid="error-banner"
      role="alert"
      className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-signal px-5 py-4 text-paper"
    >
      <div className="min-w-0">
        <p className="font-mono text-xs font-semibold tracking-wider">
          {banner.code}
          {banner.httpStatus !== null ? ` · HTTP ${banner.httpStatus}` : ''}
        </p>
        <p className="mt-1 text-sm leading-relaxed">{banner.message}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-full border border-paper/70 px-3 py-1 font-mono text-[11px] hover:bg-paper hover:text-signal"
      >
        Dismiss
      </button>
    </div>
  );
}

export function StudioFooter({ receipt }: { receipt: CalculationReceipt }) {
  return (
    <footer className="flex flex-col gap-2 border-t border-ink pt-5 font-mono text-[11px] text-steel">
      <p className="cc-eyebrow text-[10px] text-ink">Machine-readable receipt footer</p>
      <p className="break-all text-ink">{receipt.machineReadableFooter}</p>
      <p className="cc-eyebrow mt-2 text-[10px] text-ink">Local CLI replay</p>
      <p className="break-all">{receipt.replayCommand}</p>
    </footer>
  );
}
