import { CLAUSE_CLOCK_SEEDED_SCENARIOS } from '../core/clause-clock-scenarios.ts';
import type {
  CalculationReceipt,
  ClauseClockScenario,
} from '../core/clause-clock-types.ts';

export const CLAUSE_CLOCK_ACTION_KEYS = [
  'evaluate-clause-clock',
  'run-pbt-audit',
  'commit-credit-settlement',
  'reset-settlement-state',
] as const;

export type ClauseClockActionKey = (typeof CLAUSE_CLOCK_ACTION_KEYS)[number];

export type SettlementStatus = 'READY' | 'SETTLED';

export interface CapLedgerEntry {
  ledgerKey: string;
  customerId: string;
  billingMonth: string;
  monthlyCapCents: number;
  initialPriorApprovedCents: number;
  priorApprovedCents: number;
  committedInSessionCents: number;
  remainingCapCents: number;
  committedByClaimKey: Record<
    string,
    {
      proposalVersionKey: string;
      committedCents: number;
    }
  >;
}

export interface JsmInternalNote {
  noteId: string;
  claimKey: string;
  proposalVersionKey: string;
  bodyMarkdown: string;
  createdAtIso: string;
  approverId: string;
}

export interface JiraEntityPropertyRecord {
  propertyKey: string;
  claimKey: string;
  proposalVersionKey: string;
  settlementStatus: SettlementStatus;
  newCreditCents: number;
  vendorTotalApportionedCents: number;
  internalAbsorbedCents: number;
  approverId: string;
  financeOverrideReason: string | null;
  updatedAtIso: string;
  receipt: CalculationReceipt;
}

export interface KvsSettlementRecord {
  kvsKey: string;
  claimKey: string;
  scenarioId: string;
  customerId: string;
  billingMonth: string;
  proposalVersionKey: string;
  approverId: string;
  financeOverrideReason: string | null;
  committedAtIso: string;
  receipt: CalculationReceipt;
}

export interface ForgeRealtimeEvent {
  channel: 'clause-clock-settlement-sync';
  eventId: string;
  claimKey: string;
  scenarioId: string;
  status: SettlementStatus;
  proposalVersionKey: string;
  newCreditCents: number;
  vendorTotalApportionedCents: number;
  internalAbsorbedCents: number;
  approverId: string;
  timestampIso: string;
}

export interface ClauseClockStore {
  settlementStatusByClaimKey: Map<string, SettlementStatus>;
  capLedger: Map<string, CapLedgerEntry>;
  jsmInternalNotes: JsmInternalNote[];
  jiraEntityProperties: Map<string, JiraEntityPropertyRecord>;
  kvsSettlementRecords: Map<string, KvsSettlementRecord>;
  realtimeEvents: ForgeRealtimeEvent[];
}

export function getCapLedgerKey(customerId: string, billingMonth: string): string {
  return `${customerId}::${billingMonth}`;
}

export function ensureCapLedgerEntry(
  store: ClauseClockStore,
  scenario: ClauseClockScenario,
): CapLedgerEntry {
  const { customerId, billingMonth, monthlyCapCents, priorApprovedCents } =
    scenario.contract;
  const ledgerKey = getCapLedgerKey(customerId, billingMonth);
  const existing = store.capLedger.get(ledgerKey);
  if (existing) {
    return existing;
  }

  const initialPrior = Math.max(0, Math.floor(priorApprovedCents));
  const capCents = Math.max(0, Math.floor(monthlyCapCents));
  const entry: CapLedgerEntry = {
    ledgerKey,
    customerId,
    billingMonth,
    monthlyCapCents: capCents,
    initialPriorApprovedCents: initialPrior,
    priorApprovedCents: initialPrior,
    committedInSessionCents: 0,
    remainingCapCents: Math.max(0, capCents - initialPrior),
    committedByClaimKey: {},
  };
  store.capLedger.set(ledgerKey, entry);
  return entry;
}

export function createClauseClockStore(): ClauseClockStore {
  const store: ClauseClockStore = {
    settlementStatusByClaimKey: new Map<string, SettlementStatus>(),
    capLedger: new Map<string, CapLedgerEntry>(),
    jsmInternalNotes: [],
    jiraEntityProperties: new Map<string, JiraEntityPropertyRecord>(),
    kvsSettlementRecords: new Map<string, KvsSettlementRecord>(),
    realtimeEvents: [],
  };

  for (const scenario of CLAUSE_CLOCK_SEEDED_SCENARIOS) {
    store.settlementStatusByClaimKey.set(scenario.contract.claimKey, 'READY');
    ensureCapLedgerEntry(store, scenario);
  }

  return store;
}

// Next.js bundles route handlers and server-rendered pages as separate module copies (verified in the 16.3 build), so a
// module-level variable gave the studio page a different store than /api/clause-clock and /api/mcp.
const processWide = globalThis as typeof globalThis & { __clauseClockDefaultStore?: ClauseClockStore };

export function getDefaultClauseClockStore(): ClauseClockStore {
  processWide.__clauseClockDefaultStore ??= createClauseClockStore();
  return processWide.__clauseClockDefaultStore;
}
