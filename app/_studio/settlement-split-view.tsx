'use client';

import { useEffect, useId, useReducer } from 'react';
import type { CalculationReceipt } from '../../src/core/clause-clock-types.ts';
import { formatMinutes, formatUsdCents } from './format.ts';
import { CLAUSE_CLOCK_SETTLEMENT_CHANNEL, type ClauseClockHostPort } from './host-port.ts';
import {
  createInitialFinanceState,
  financeSubscriberReducer,
  selectClaimSettlement,
  type ClaimSettlementView,
  type SettlementMap,
} from './settlement-sync.ts';
import type { CommitBlocker, CommitGate, WorkbenchApproval } from './workbench-controller.ts';

const BLOCKER_COPY: Record<CommitBlocker, string> = {
  ACTION_IN_FLIGHT: 'Write-back in flight…',
  ALREADY_SETTLED: 'Already settled — reset the demo write-back to run it again.',
  APPROVER_ID_REQUIRED: 'Enter the approver ID that signs the token.',
  APPROVAL_REQUIRED: 'Flip the human approval switch for this exact proposal key.',
  FINANCE_OVERRIDE_REQUIRED: 'Provisional Draft Mode: record a Finance override reason first.',
};

function StatusPill({ testId, status }: { testId: string; status: ClaimSettlementView['status'] }) {
  const settled = status === 'SETTLED';
  return (
    <span
      data-testid={testId}
      data-status={status}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono text-[11px] font-semibold tracking-wider ${
        settled ? 'bg-lume text-ink' : 'border border-current'
      }`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${settled ? 'bg-ink' : 'bg-current'}`} />
      {status}
    </span>
  );
}

function SettledSummary({ receipt, approverId }: { receipt: CalculationReceipt; approverId: string | null }) {
  const math = receipt.mathBreakdown;
  return (
    <dl className="grid grid-cols-3 gap-3 font-mono text-[11px]">
      <div>
        <dt className="cc-eyebrow text-[9px] opacity-70">Customer credit</dt>
        <dd className="mt-1 font-display text-2xl">{formatUsdCents(math.newCreditCents)}</dd>
      </div>
      <div>
        <dt className="cc-eyebrow text-[9px] opacity-70">Vendor recovery</dt>
        <dd className="mt-1 font-display text-2xl">{formatUsdCents(math.vendorTotalApportionedCents)}</dd>
      </div>
      <div>
        <dt className="cc-eyebrow text-[9px] opacity-70">Internal</dt>
        <dd className="mt-1 font-display text-2xl">{formatUsdCents(math.internalAbsorbedCents)}</dd>
      </div>
      <div className="col-span-3 break-all opacity-80">
        {receipt.receiptId} · approved by {approverId ?? 'unknown'}
      </div>
    </dl>
  );
}

interface FinanceSubscriberPanelProps {
  hostPort: ClauseClockHostPort;
  claimKey: string;
  initialSettlements: SettlementMap | undefined;
}

// A separate reducer on purpose: this panel models the jira:globalPage instance, which loads the store snapshot once and
// afterwards only learns about settlements through the realtime channel, never from the Support panel's own response.
function FinanceSubscriberPanel({ hostPort, claimKey, initialSettlements }: FinanceSubscriberPanelProps) {
  const [finance, receive] = useReducer(financeSubscriberReducer, initialSettlements, createInitialFinanceState);
  useEffect(() => hostPort.subscribeSettlementChannel(receive), [hostPort, receive]);
  const view = selectClaimSettlement(finance, claimKey);

  return (
    <section data-testid="finance-view" aria-labelledby="cc-finance-heading" className="cc-case flex flex-col gap-4 rounded-[2rem] p-5 @3xl:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="cc-eyebrow text-brass">Finance · jira:globalPage</p>
          <h3 id="cc-finance-heading" className="mt-1 font-display text-2xl leading-none text-case-text">
            Portfolio ledger
          </h3>
          <p className="mt-1 font-mono text-[11px] text-case-muted">
            @forge/realtime subscriber · {CLAUSE_CLOCK_SETTLEMENT_CHANNEL}
          </p>
        </div>
        <StatusPill testId="finance-settlement-status" status={view.status} />
      </header>

      <div className="relative h-7 overflow-hidden rounded-full border border-case-rule bg-case-3/60">
        <span aria-hidden className="absolute inset-y-1/2 left-3 right-3 h-px bg-case-rule" />
        {view.lastEventId ? (
          <span
            key={view.lastEventId}
            aria-hidden
            className="cc-pulse absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-lume shadow-[0_0_14px_rgb(217_242_106/0.9)]"
          />
        ) : null}
        <span
          aria-live="polite"
          className="absolute inset-0 flex items-center justify-center font-mono text-[10px] text-case-muted"
        >
          {view.lastEventId ? `${view.lastEventId} · ${view.status}` : 'listening for broadcasts…'}
        </span>
      </div>

      {view.settledReceipt ? (
        <div className="text-case-text">
          <SettledSummary receipt={view.settledReceipt} approverId={view.approverId} />
        </div>
      ) : (
        <p className="font-mono text-xs text-case-muted">
          {claimKey} has no settled receipt on this page yet. A commit from Support or from a Rovo MCP client lands here.
        </p>
      )}
    </section>
  );
}

export interface SettlementSplitViewProps {
  hostPort: ClauseClockHostPort;
  initialSettlements: SettlementMap | undefined;
  receipt: CalculationReceipt;
  settlement: ClaimSettlementView;
  approverId: string;
  approval: WorkbenchApproval;
  gate: CommitGate;
  resetDisabled: boolean;
  onApproverChange: (approverId: string) => void;
  onApprovalChange: (checked: boolean) => void;
  onCommit: () => void;
  onReset: () => void;
}

export function SettlementSplitView({
  hostPort,
  initialSettlements,
  receipt,
  settlement,
  approverId,
  approval,
  gate,
  resetDisabled,
  onApproverChange,
  onApprovalChange,
  onCommit,
  onReset,
}: SettlementSplitViewProps) {
  const approverInputId = useId();
  const approvalSwitchId = useId();
  const math = receipt.mathBreakdown;
  const settled = settlement.status === 'SETTLED';
  // Once settled, the only actionable reason is the reset; listing the approval prompt too would invite a pointless click.
  const visibleBlockers: readonly CommitBlocker[] = gate.blockers.includes('ALREADY_SETTLED')
    ? ['ALREADY_SETTLED']
    : gate.blockers;
  const approvedForThisKey = approval.checked && approval.proposalVersionKey === receipt.proposalVersionKey;
  const tokenPreview = approvedForThisKey
    ? `APPROVAL::${receipt.proposalVersionKey}::${approverId.trim() || '<approverId>'}`
    : `APPROVAL::${receipt.proposalVersionKey}::<approverId>`;
  const writeTargets = [
    { target: 'JSM internal note', key: receipt.claimKey, detail: 'settlement receipt · vendor split · footer' },
    { target: 'Jira entity property', key: `clauseclock.settlement @ ${receipt.claimKey}`, detail: 'status · cents · approver' },
    { target: 'Forge KVS', key: `settlement::${receipt.claimKey}::${receipt.proposalVersionKey}`, detail: 'idempotency record' },
    {
      target: 'Cap ledger',
      key: `${receipt.customerId}::${receipt.billingMonth}`,
      detail: `${formatUsdCents(math.remainingCapBeforeCents)} → ${formatUsdCents(math.remainingCapAfterCents)} remaining`,
    },
    { target: '@forge/realtime', key: CLAUSE_CLOCK_SETTLEMENT_CHANNEL, detail: 'publishGlobal · compact event' },
  ];

  return (
    <section aria-labelledby="cc-settlement-heading" className="cc-rise">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="cc-settlement-heading" className="flex items-baseline gap-3">
          <span className="font-display text-3xl leading-none">Settlement write-back</span>
          <span className="cc-eyebrow text-steel">split view · two Forge surfaces, one realtime channel</span>
        </h2>
      </div>
      <div className="grid items-start gap-4 @5xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section
          data-testid="support-view"
          aria-labelledby="cc-support-heading"
          className="cc-paper flex flex-col gap-4 rounded-[2rem] p-5 @3xl:p-6"
        >
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="cc-eyebrow text-steel">Support · jira:issuePanel</p>
              <h3 id="cc-support-heading" className="mt-1 font-display text-2xl leading-none">
                {receipt.claimKey} · {receipt.customerName}
              </h3>
              <p className="mt-1 font-mono text-[11px] text-steel">
                {formatMinutes(math.netOutageMinutes)} net · {formatUsdCents(math.newCreditCents)} credit ·{' '}
                {formatUsdCents(math.vendorTotalApportionedCents)} vendor
              </p>
            </div>
            <StatusPill testId="support-settlement-status" status={settlement.status} />
          </header>

          {settlement.settledReceipt ? (
            <div className="rounded-2xl bg-ink p-4 text-paper">
              <SettledSummary receipt={settlement.settledReceipt} approverId={settlement.approverId} />
            </div>
          ) : null}

          <div data-testid="writeback-preview" className="rounded-2xl border border-dashed border-ink/25 p-4">
            <p className="cc-eyebrow text-[10px] text-steel">
              {settled
                ? 'Write-back recorded · reset restores every target below'
                : 'Dry-run write-back · nothing is written until you commit'}
            </p>
            <ul className="mt-2 divide-y divide-ink/10">
              {writeTargets.map((row) => (
                <li key={row.target} className="grid gap-x-3 py-1.5 font-mono text-[11px] @xl:grid-cols-[9rem_minmax(0,1fr)]">
                  <span className="font-semibold text-ink">{row.target}</span>
                  <span className="min-w-0 wrap-anywhere text-steel">
                    {row.key} <span className="text-ink-soft">· {row.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-3 @xl:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <div>
              <label htmlFor={approverInputId} className="cc-eyebrow text-[10px] text-steel">
                Approver ID
              </label>
              <input
                id={approverInputId}
                data-testid="approver-id-input"
                type="text"
                value={approverId}
                onChange={(event) => onApproverChange(event.target.value)}
                placeholder="e.g. USR-SUPPORT-LEAD"
                className="mt-1 w-full rounded-lg border border-ink/20 bg-dial px-3 py-2 font-mono text-xs placeholder:text-steel/70"
              />
            </div>
            <div className="flex items-start gap-3 rounded-xl border border-ink/15 bg-dial p-3">
              <input
                id={approvalSwitchId}
                data-testid="approval-switch"
                type="checkbox"
                role="switch"
                className="cc-switch mt-0.5"
                checked={approvedForThisKey}
                onChange={(event) => onApprovalChange(event.target.checked)}
              />
              <label htmlFor={approvalSwitchId} className="min-w-0 text-sm">
                <span className="font-semibold">Human approval</span> — I approve proposal
                <span className="mt-1 block break-all font-mono text-[11px] text-steel">{receipt.proposalVersionKey}</span>
              </label>
            </div>
          </div>

          <p className="break-all rounded-lg bg-ink/5 px-3 py-2 font-mono text-[11px] text-ink-soft">
            token · {tokenPreview}
          </p>

          {visibleBlockers.length > 0 ? (
            <ul className="flex flex-col gap-1 text-xs text-ink-soft">
              {visibleBlockers.map((blocker) => (
                <li key={blocker} className="flex gap-2">
                  <span aria-hidden className="text-signal">◆</span>
                  {BLOCKER_COPY[blocker]}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              data-testid="commit-settlement-button"
              disabled={!gate.canCommit}
              onClick={onCommit}
              className="rounded-full bg-signal px-5 py-2.5 text-sm font-semibold text-paper shadow-[0_10px_24px_-14px_rgb(227_38_27/0.9)] transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-rule disabled:text-steel disabled:shadow-none"
            >
              Confirm Settlement &amp; Write Back
            </button>
            <button
              type="button"
              data-testid="reset-demo-writeback-button"
              disabled={resetDisabled}
              onClick={onReset}
              className="rounded-full border border-ink px-5 py-2.5 text-sm font-semibold transition hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-40"
            >
              Reset Demo Write-Back
            </button>
          </div>
        </section>

        <FinanceSubscriberPanel
          hostPort={hostPort}
          claimKey={receipt.claimKey}
          initialSettlements={initialSettlements}
        />
      </div>
    </section>
  );
}
