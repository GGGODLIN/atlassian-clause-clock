import type { SettlementStatus } from '../../src/actions/clause-clock-store.ts';
import type { CalculationReceipt } from '../../src/core/clause-clock-types.ts';
import type { SettlementBroadcast, SettlementBroadcastOrigin } from './host-port.ts';

export interface ClaimSettlementView {
  claimKey: string;
  status: SettlementStatus;
  proposalVersionKey: string | null;
  settledReceipt: CalculationReceipt | null;
  approverId: string | null;
  lastEventId: string | null;
}

export interface FinanceFeedEntry {
  sequence: number;
  eventId: string;
  claimKey: string;
  status: SettlementStatus;
  origin: SettlementBroadcastOrigin;
  proposalVersionKey: string;
  newCreditCents: number;
  vendorTotalApportionedCents: number;
  internalAbsorbedCents: number;
  approverId: string;
  timestampIso: string;
}

export interface FinanceSubscriberState {
  feed: readonly FinanceFeedEntry[];
  settlements: Readonly<Record<string, ClaimSettlementView>>;
}

const FINANCE_FEED_LIMIT = 12;

export function createReadySettlementView(claimKey: string): ClaimSettlementView {
  return {
    claimKey,
    status: 'READY',
    proposalVersionKey: null,
    settledReceipt: null,
    approverId: null,
    lastEventId: null,
  };
}

export function applySettlementBroadcast(
  view: ClaimSettlementView,
  message: SettlementBroadcast,
): ClaimSettlementView {
  const { event, receipt } = message;
  if (event.claimKey !== view.claimKey) {
    return view;
  }
  const settled = event.status === 'SETTLED';
  return {
    claimKey: view.claimKey,
    status: event.status,
    proposalVersionKey: event.proposalVersionKey,
    settledReceipt: settled ? receipt : null,
    approverId: settled ? event.approverId : null,
    lastEventId: event.eventId,
  };
}

export function createInitialFinanceState(): FinanceSubscriberState {
  return { feed: [], settlements: {} };
}

export function financeSubscriberReducer(
  state: FinanceSubscriberState,
  message: SettlementBroadcast,
): FinanceSubscriberState {
  const { event } = message;
  // Server event ids restart with the in-memory store, so the feed keys on its own monotonic sequence instead.
  const entry: FinanceFeedEntry = {
    sequence: (state.feed[0]?.sequence ?? 0) + 1,
    eventId: event.eventId,
    claimKey: event.claimKey,
    status: event.status,
    origin: message.origin,
    proposalVersionKey: event.proposalVersionKey,
    newCreditCents: event.newCreditCents,
    vendorTotalApportionedCents: event.vendorTotalApportionedCents,
    internalAbsorbedCents: event.internalAbsorbedCents,
    approverId: event.approverId,
    timestampIso: event.timestampIso,
  };
  const current = state.settlements[event.claimKey] ?? createReadySettlementView(event.claimKey);
  return {
    feed: [entry, ...state.feed].slice(0, FINANCE_FEED_LIMIT),
    settlements: {
      ...state.settlements,
      [event.claimKey]: applySettlementBroadcast(current, message),
    },
  };
}

export function selectFinanceSettlement(
  state: FinanceSubscriberState,
  claimKey: string,
): ClaimSettlementView {
  return state.settlements[claimKey] ?? createReadySettlementView(claimKey);
}
