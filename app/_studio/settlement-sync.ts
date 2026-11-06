import type { ClauseClockStore, SettlementStatus } from '../../src/actions/clause-clock-store.ts';
import type { CalculationReceipt } from '../../src/core/clause-clock-types.ts';
import type { SettlementBroadcast } from './host-port.ts';

export interface ClaimSettlementView {
  claimKey: string;
  status: SettlementStatus;
  proposalVersionKey: string | null;
  settledReceipt: CalculationReceipt | null;
  approverId: string | null;
  lastEventId: string | null;
}

export type SettlementMap = Readonly<Record<string, ClaimSettlementView>>;

export interface FinanceSubscriberState {
  settlements: SettlementMap;
}

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

export function selectClaimSettlement(
  holder: { settlements: SettlementMap },
  claimKey: string,
): ClaimSettlementView {
  return holder.settlements[claimKey] ?? createReadySettlementView(claimKey);
}

export function createInitialFinanceState(settlements: SettlementMap = {}): FinanceSubscriberState {
  return { settlements };
}

export function financeSubscriberReducer(
  state: FinanceSubscriberState,
  message: SettlementBroadcast,
): FinanceSubscriberState {
  const { event } = message;
  return {
    settlements: {
      ...state.settlements,
      [event.claimKey]: applySettlementBroadcast(selectClaimSettlement(state, event.claimKey), message),
    },
  };
}

// Panels must open on what the shared store already holds: a reload or a second judge would otherwise see READY for a
// settled claim, and the follow-up commit only replays. Matches entity properties by their claimKey field rather than
// rebuilding the dispatcher's storage key.
export function snapshotStoreSettlements(store: ClauseClockStore): Record<string, ClaimSettlementView> {
  const settledProperties = new Map(
    [...store.jiraEntityProperties.values()].map((property) => [property.claimKey, property]),
  );
  const views: Record<string, ClaimSettlementView> = {};
  for (const [claimKey, status] of store.settlementStatusByClaimKey) {
    const property = status === 'SETTLED' ? settledProperties.get(claimKey) : undefined;
    views[claimKey] = property
      ? {
          claimKey,
          status: 'SETTLED',
          proposalVersionKey: property.proposalVersionKey,
          settledReceipt: property.receipt,
          approverId: property.approverId,
          lastEventId: null,
        }
      : createReadySettlementView(claimKey);
  }
  return views;
}
