'use client';

import { reconcileClauseClock } from '../../src/core/clause-clock-engine.ts';
import { CLAUSE_CLOCK_SEEDED_SCENARIOS } from '../../src/core/clause-clock-scenarios.ts';
import { formatMinutes, formatUsdCents } from './format.ts';

interface ScenarioCard {
  scenarioId: string;
  numeral: string;
  claimKey: string;
  customerName: string;
  headline: string;
  edgeCase: string;
  naiveMinutes: number;
  netMinutes: number;
  naiveCreditCents: number;
  creditCents: number;
}

const CARD_NUMERALS = ['I', 'II', 'III', 'IV'] as const;

function describeEdgeCase(flags: { missingTimezone: boolean; capTruncated: boolean; draft: boolean }): string {
  if (flags.missingTimezone) {
    return 'Timezone boundary';
  }
  if (flags.capTruncated) {
    return 'Cap truncation';
  }
  if (flags.draft) {
    return 'Draft contract lock';
  }
  return 'Overlap fold';
}

// Seeded fixtures are immutable, so their headline figures are computed once at module load with the same core engine.
const SCENARIO_CARDS: readonly ScenarioCard[] = CLAUSE_CLOCK_SEEDED_SCENARIOS.map((scenario, position) => {
  const receipt = reconcileClauseClock(scenario);
  return {
    scenarioId: scenario.scenarioId,
    numeral: CARD_NUMERALS[position] ?? String(position + 1),
    claimKey: scenario.contract.claimKey,
    customerName: scenario.contract.customerName,
    headline: scenario.title.replace(/^\d+\.\s*/, '').replace(/\s*\(.*\)\s*$/, ''),
    edgeCase: describeEdgeCase({
      missingTimezone: receipt.missingTimezoneFallback,
      capTruncated: receipt.mathBreakdown.capTruncated,
      draft: receipt.provisionalDraftMode,
    }),
    naiveMinutes: receipt.naiveComparison.rawIncidentSumMinutes,
    netMinutes: receipt.mathBreakdown.netOutageMinutes,
    naiveCreditCents: receipt.naiveComparison.naiveCreditCents,
    creditCents: receipt.mathBreakdown.newCreditCents,
  };
});

export interface ScenarioSelectorProps {
  selectedScenarioId: string;
  onSelect: (scenarioId: string) => void;
}

export function ScenarioSelector({ selectedScenarioId, onSelect }: ScenarioSelectorProps) {
  return (
    <section data-testid="scenario-selector" aria-labelledby="cc-scenario-heading" className="cc-rise">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="cc-scenario-heading" className="flex items-baseline gap-3">
          <span className="font-display text-2xl italic leading-none">1-Click Seed</span>
          <span className="cc-eyebrow text-steel">4 canonical JSM claims · zero site setup</span>
        </h2>
        <p className="font-mono text-[11px] text-steel">spreadsheet → ClauseClock</p>
      </div>
      <div className="grid gap-3 @xl:grid-cols-2 @7xl:grid-cols-4">
        {SCENARIO_CARDS.map((card) => {
          const selected = card.scenarioId === selectedScenarioId;
          return (
            <button
              key={card.scenarioId}
              type="button"
              data-testid="scenario-option"
              data-scenario-id={card.scenarioId}
              aria-pressed={selected}
              onClick={() => onSelect(card.scenarioId)}
              className={`group relative flex min-h-36 flex-col overflow-hidden rounded-2xl border p-4 text-left transition duration-300 hover:-translate-y-0.5 ${
                selected
                  ? 'cc-case border-transparent text-case-text'
                  : 'border-rule bg-paper text-ink hover:border-ink/40 hover:shadow-[0_14px_30px_-20px_rgb(17_17_17/0.6)]'
              }`}
            >
              <span className="flex items-start justify-between gap-3">
                <span className={`font-display text-3xl italic leading-none ${selected ? 'text-lume' : 'text-ink/30'}`}>
                  {card.numeral}
                </span>
                <span
                  className={`cc-eyebrow rounded-full border px-2 py-0.5 text-[10px] ${
                    selected ? 'border-signal/70 text-signal' : 'border-rule text-steel'
                  }`}
                >
                  {card.edgeCase}
                </span>
              </span>
              <span className={`mt-3 font-mono text-xs ${selected ? 'text-brass' : 'text-steel'}`}>
                {card.claimKey} · {card.customerName}
              </span>
              <span className="mt-1 text-[15px] font-semibold leading-snug">{card.headline}</span>
              <span className="mt-auto flex items-baseline gap-2 pt-4 font-mono text-xs">
                <span className={`line-through decoration-signal decoration-2 ${selected ? 'text-case-muted' : 'text-steel'}`}>
                  {formatMinutes(card.naiveMinutes)} · {formatUsdCents(card.naiveCreditCents)}
                </span>
                <span aria-hidden className="text-signal">→</span>
                <span className={selected ? 'text-lume' : 'text-ink'}>
                  {formatMinutes(card.netMinutes)} · {formatUsdCents(card.creditCents)}
                </span>
              </span>
              {selected ? <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-signal" /> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
