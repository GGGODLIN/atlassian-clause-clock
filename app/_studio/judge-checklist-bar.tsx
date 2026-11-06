'use client';

import { JUDGE_CHECKLIST_STEPS, type ChecklistStepId } from './workbench-controller.ts';

const STEP_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;

export interface JudgeChecklistBarProps {
  completedSteps: readonly ChecklistStepId[];
}

export function JudgeChecklistBar({ completedSteps }: JudgeChecklistBarProps) {
  const completed = new Set(completedSteps);
  const total = JUDGE_CHECKLIST_STEPS.length;
  const progressPct = Math.round((completed.size / total) * 1000) / 10;

  return (
    <section
      data-testid="judge-checklist-bar"
      aria-label="3-Minute Judge Checklist"
      className="cc-case cc-rise rounded-[1.75rem] px-5 py-4 @3xl:px-7"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h2 className="flex items-baseline gap-3">
          <span className="font-display text-3xl italic leading-none text-case-text">3-Minute</span>
          <span className="cc-eyebrow text-brass">Judge Checklist · Codegeist 2026</span>
        </h2>
        <p className="font-mono text-xs text-case-muted">
          <span className="text-lume">{completed.size}</span> / {total} capabilities verified in this session
        </p>
      </div>

      <div aria-hidden className="mt-3 h-[3px] overflow-hidden rounded-full bg-case-3">
        <div
          className="h-full bg-lume shadow-[0_0_12px_rgb(217_242_106/0.6)] transition-[width] duration-700 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <ol className="mt-4 grid grid-cols-1 gap-2 @lg:grid-cols-2 @4xl:grid-cols-4 @7xl:grid-cols-7">
        {JUDGE_CHECKLIST_STEPS.map((step, position) => {
          const done = completed.has(step.id);
          return (
            <li
              key={step.id}
              data-testid="judge-checklist-step"
              data-step-id={step.id}
              data-complete={done}
              className={`relative flex gap-3 rounded-xl border px-3 py-2.5 transition-colors duration-300 ${
                done
                  ? 'border-lume/50 bg-lume/10'
                  : 'border-case-rule bg-case-2/60'
              }`}
            >
              <span
                aria-hidden
                className={`font-display text-xl italic leading-none ${done ? 'text-lume' : 'text-brass'}`}
              >
                {STEP_NUMERALS[position]}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-case-text">
                  {step.title}
                  <span className="sr-only">{done ? ' (done)' : ' (to do)'}</span>
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-case-muted">{step.hint}</span>
              </span>
              <span
                aria-hidden
                className={`absolute right-3 top-3 size-2 rounded-full ${
                  done ? 'bg-lume shadow-[0_0_10px_rgb(217_242_106/0.8)]' : 'border border-case-muted/60'
                }`}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
