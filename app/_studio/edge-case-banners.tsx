'use client';

import { useId, type ReactNode } from 'react';
import type { CalculationReceipt, ClauseClockScenario } from '../../src/core/clause-clock-types.ts';
import { formatMinutes, formatUsdCents } from './format.ts';
import type { TimezoneOption } from './workbench-controller.ts';

export interface TimezoneSwitcherProps {
  options: readonly TimezoneOption[];
  value: string | null;
  label: string;
  onChange: (timezoneOverride: string | null) => void;
}

export function TimezoneSwitcher({ options, value, label, onChange }: TimezoneSwitcherProps) {
  return (
    <div
      data-testid="timezone-switcher"
      role="group"
      aria-label={label}
      className="inline-flex flex-wrap gap-1 rounded-full border border-ink/15 bg-paper p-1"
    >
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.timezone}
            type="button"
            data-testid="timezone-option"
            data-timezone={option.timezone}
            aria-pressed={pressed}
            onClick={() => onChange(option.value)}
            className={`rounded-full px-3 py-1 font-mono text-xs transition-colors ${
              pressed ? 'bg-ink text-lume' : 'text-ink-soft hover:bg-ink/5'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface BannerFrameProps {
  testId: string;
  glyph: string;
  title: string;
  children: ReactNode;
}

function BannerFrame({ testId, glyph, title, children }: BannerFrameProps) {
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className="cc-rise relative flex gap-4 overflow-hidden rounded-2xl border border-signal/30 bg-paper p-4 pl-5 shadow-[0_12px_30px_-24px_rgb(227_38_27/0.8)]"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-signal" />
      <span
        aria-hidden
        className="grid size-11 flex-none place-items-center rounded-lg border border-signal/50 font-mono text-[10px] font-semibold tracking-widest text-signal"
      >
        {glyph}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <div className="mt-1 text-sm leading-relaxed text-ink-soft">{children}</div>
      </div>
    </section>
  );
}

export interface EdgeCaseBannersProps {
  scenario: ClauseClockScenario;
  receipt: CalculationReceipt;
  timezoneOptions: readonly TimezoneOption[];
  timezoneOverride: string | null;
  financeOverrideReason: string;
  onTimezoneChange: (timezoneOverride: string | null) => void;
  onFinanceOverrideChange: (reason: string) => void;
}

export function EdgeCaseBanners({
  scenario,
  receipt,
  timezoneOptions,
  timezoneOverride,
  financeOverrideReason,
  onTimezoneChange,
  onFinanceOverrideChange,
}: EdgeCaseBannersProps) {
  const financeOverrideId = useId();
  const math = receipt.mathBreakdown;
  const missingTimezone = !scenario.contract.billingTimezone?.trim();
  const clippedMinutes = Math.max(0, receipt.naiveComparison.rawIncidentSumMinutes - math.rawIncidentMinutes);

  if (!missingTimezone && !receipt.provisionalDraftMode && !math.capTruncated) {
    return null;
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,26rem),1fr))] gap-3">
      {missingTimezone ? (
        <BannerFrame testId="banner-missing-timezone" glyph="TZ" title="Missing contract timezone">
          <p>
            <span className="font-mono">{receipt.provenance.contractId}</span> carries no billing timezone, so the{' '}
            {receipt.billingMonth} billing month is evaluated in{' '}
            <strong className="font-semibold text-ink">{receipt.billingTimezone}</strong>
            {receipt.missingTimezoneFallback ? ' (UTC fallback)' : ' (manual override)'}.{' '}
            <strong className="font-semibold text-signal">{formatMinutes(clippedMinutes)}</strong> of incident time falls
            outside that month in this timezone.
          </p>
          <div className="mt-3">
            <TimezoneSwitcher
              options={timezoneOptions}
              value={timezoneOverride}
              label="Billing timezone"
              onChange={onTimezoneChange}
            />
          </div>
        </BannerFrame>
      ) : null}

      {receipt.provisionalDraftMode ? (
        <BannerFrame testId="banner-provisional-draft" glyph="DRFT" title="Provisional Draft Mode">
          <p>
            Contract <span className="font-mono">{receipt.provenance.contractId}</span> is still in Legal review. The full
            interval algebra and vendor split are previewed, but write-back stays locked until Finance records an
            override reason.
          </p>
          <label htmlFor={financeOverrideId} className="cc-eyebrow mt-3 block text-[10px] text-steel">
            Finance override reason
          </label>
          <input
            id={financeOverrideId}
            data-testid="finance-override-input"
            type="text"
            value={financeOverrideReason}
            onChange={(event) => onFinanceOverrideChange(event.target.value)}
            placeholder="e.g. VP Finance sign-off on addendum FIN-882"
            className="mt-1 w-full rounded-lg border border-ink/20 bg-dial px-3 py-2 font-mono text-xs text-ink placeholder:text-steel/70 focus:border-ink"
          />
        </BannerFrame>
      ) : null}

      {math.capTruncated ? (
        <section
          data-testid="badge-cap-truncation"
          data-uncapped-cents={math.uncappedAvailableCreditCents}
          data-capped-cents={math.newCreditCents}
          aria-label="Monthly cap truncation"
          className="cc-case cc-rise col-span-full flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl p-4"
        >
          <span className="cc-eyebrow text-brass">Monthly cap truncation</span>
          <span className="flex items-baseline gap-2">
            <span className="cc-eyebrow text-[10px] text-case-muted">Uncapped</span>
            <span className="font-display text-3xl text-case-text/60 line-through decoration-signal">
              {formatUsdCents(math.uncappedAvailableCreditCents)}
            </span>
          </span>
          <span aria-hidden className="text-signal">→</span>
          <span className="flex items-baseline gap-2">
            <span className="cc-eyebrow text-[10px] text-lume">Capped</span>
            <span className="font-display text-3xl text-lume">{formatUsdCents(math.newCreditCents)}</span>
          </span>
          <span className="font-mono text-[11px] text-case-muted">
            cap {formatUsdCents(receipt.inputsSnapshot.monthlyCapCents)} · already approved{' '}
            {formatUsdCents(math.priorApprovedCents)} · remaining {formatUsdCents(math.remainingCapBeforeCents)}
          </span>
        </section>
      ) : null}
    </div>
  );
}
