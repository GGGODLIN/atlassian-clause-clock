import { z } from 'zod';
import { executeClauseClockAction, loadScenarioWithFallback, type ClauseClockActionResult } from '../actions/clause-clock-dispatcher.ts';
import { createClauseClockStore, ensureCapLedgerEntry, type ClauseClockStore } from '../actions/clause-clock-store.ts';
import { getSeededScenario } from '../core/clause-clock-scenarios.ts';
import type { ClauseClockScenario } from '../core/clause-clock-types.ts';

const interval = z.object({
  id: z.string(), label: z.string(), startMinute: z.number().int(), endMinute: z.number().int(),
  sourceKey: z.string().optional(), included: z.boolean().optional(),
});
export const liveScenarioSchema = z.object({
  scenarioId: z.string(), title: z.string(), subtitle: z.string(), description: z.string(),
  contract: z.object({
    contractId: z.string(), customerName: z.string(), customerId: z.string(), claimKey: z.string(),
    billingMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), billingMonthTotalMinutes: z.number().int().positive(),
    billingTimezone: z.string().optional(), contractStatus: z.enum(['APPROVED', 'DRAFT']),
    monthlyFeeCents: z.number().int().nonnegative(), monthlyCapCents: z.number().int().nonnegative(),
    priorApprovedCents: z.number().int().nonnegative(), confluenceContractUrl: z.string().url(),
    slaTiers: z.array(z.object({ tierId: z.string(), label: z.string(), minUptimeBps: z.number(), maxUptimeBps: z.number(), minOutageMinutes: z.number().optional(), maxOutageMinutes: z.number().optional(), creditBps: z.number().int().min(0).max(10000) })).min(1),
  }),
  incidents: z.array(interval), maintenanceWindows: z.array(interval),
  vendorFeeds: z.array(z.object({ vendorId: z.string(), vendorName: z.string(), componentKey: z.string(), intervals: z.array(interval) })),
});

export interface StoredAccount {
  revision: number;
  snapshot: string;
  pending: ClauseClockActionResult | null;
}

export interface ForgeRuntimePort {
  authorizeMutation?(issueKey: string): Promise<void>;
  loadScenario(issueKey: string): Promise<ClauseClockScenario | null>;
  readAccount(key: string): Promise<StoredAccount | undefined>;
  initializeAccount(key: string, value: StoredAccount): Promise<void>;
  compareAndSetAccount(key: string, revision: number, value: StoredAccount): Promise<void>;
  deliver(result: ClauseClockActionResult): Promise<void>;
}

export interface ForgeActionResponse extends ClauseClockActionResult {
  scenario?: ClauseClockScenario;
  deliveryStatus?: 'DELIVERED' | 'PENDING_RETRY';
  deliveryMessage?: string;
}

export function serializeStore(store: ClauseClockStore): string {
  return JSON.stringify({
    settlementStatusByClaimKey: [...store.settlementStatusByClaimKey],
    capLedger: [...store.capLedger], jsmInternalNotes: store.jsmInternalNotes,
    jiraEntityProperties: [...store.jiraEntityProperties], kvsSettlementRecords: [...store.kvsSettlementRecords],
    realtimeEvents: store.realtimeEvents.slice(-20),
  });
}

export function deserializeStore(snapshot: string): ClauseClockStore {
  const data = JSON.parse(snapshot);
  return {
    settlementStatusByClaimKey: new Map(data.settlementStatusByClaimKey),
    capLedger: new Map(data.capLedger), jsmInternalNotes: data.jsmInternalNotes,
    jiraEntityProperties: new Map(data.jiraEntityProperties), kvsSettlementRecords: new Map(data.kvsSettlementRecords),
    realtimeEvents: data.realtimeEvents,
  };
}

export async function executeForgeAction(
  port: ForgeRuntimePort,
  actionKey: string,
  payload: Record<string, unknown>,
  issueKey?: string,
): Promise<ForgeActionResponse> {
  const lookup = typeof payload.scenarioId === 'string' ? payload.scenarioId : undefined;
  const target = issueKey ?? getSeededScenario(lookup).contract.claimKey;
  const loaded = await loadScenarioWithFallback({ scenarioId: lookup ?? target, liveGraphFetcher: () => port.loadScenario(target) });
  const scenario = loaded.scenario;
  if (loaded.sourceMode === 'LIVE_GRAPH_AND_REST' && (actionKey === 'commit-credit-settlement' || actionKey === 'reset-settlement-state')) {
    await port.authorizeMutation?.(scenario.contract.claimKey);
  }
  // Live and demonstration balances never share a ledger, even when a fixture uses the same customer ID.
  const key = `${loaded.sourceMode}:${scenario.contract.customerId}:${scenario.contract.billingMonth}`;
  let account = await port.readAccount(key);
  if (!account) {
    const initial = createClauseClockStore();
    initial.capLedger.clear();
    ensureCapLedgerEntry(initial, scenario);
    const candidate = { revision: 0, snapshot: serializeStore(initial), pending: null };
    try {
      await port.initializeAccount(key, candidate);
      account = candidate;
    } catch (error) {
      account = await port.readAccount(key);
      if (!account) throw error;
    }
  }
  const pending = account.pending;
  if (pending) {
    if (pending.receipt?.provenance.sourceMode === 'LIVE_GRAPH_AND_REST') await port.authorizeMutation?.(pending.receipt.claimKey);
    try {
      await port.deliver(pending);
      const delivered = { ...account, revision: account.revision + 1, pending: null };
      await port.compareAndSetAccount(key, account.revision, delivered);
      account = delivered;
    } catch {
      return { ...pending, deliveryStatus: 'PENDING_RETRY', deliveryMessage: 'The ledger is saved; Jira/realtime delivery is pending. Retry this action before making another change.' };
    }
  }
  const store = deserializeStore(account.snapshot);
  store.scenariosById = new Map([[scenario.scenarioId, scenario], [scenario.contract.claimKey, scenario]]);
  const result: ForgeActionResponse = executeClauseClockAction(store, actionKey, {
    ...payload, scenarioId: scenario.scenarioId, sourceMode: loaded.sourceMode, fallbackReason: loaded.fallbackReason,
    // Reset is scoped to this customer/month and cannot erase unrelated accounts.
    resetAll: false,
  });
  if (result.ok && result.receipt) {
    result.scenario = { ...scenario, contract: { ...scenario.contract, priorApprovedCents: result.receipt.inputsSnapshot.priorApprovedCents } };
    result.jiraEntityProperty = store.jiraEntityProperties.get(`${result.receipt.claimKey}::clauseclock.settlement`);
  }
  if (!result.ok || actionKey === 'evaluate-clause-clock' || actionKey === 'run-pbt-audit' || result.idempotentReplay) return result;
  const saved = { revision: account.revision + 1, snapshot: serializeStore(store), pending: result };
  await port.compareAndSetAccount(key, account.revision, saved);
  try {
    await port.deliver(result);
    await port.compareAndSetAccount(key, saved.revision, { ...saved, revision: saved.revision + 1, pending: null });
    return { ...result, deliveryStatus: 'DELIVERED' };
  } catch {
    return { ...result, deliveryStatus: 'PENDING_RETRY', deliveryMessage: 'The ledger is saved; Jira/realtime delivery is pending. Retry to resume delivery without deducting the cap again.' };
  }
}
