import type { SettlementStatus } from '../../src/actions/clause-clock-store.ts';
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

export interface FinanceSubscriberState {
  settlements: Readonly<Record<string, ClaimSettlementView>>;
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

export function createInitialFinanceState(): FinanceSubscriberState {
  return { settlements: {} };
}

export function financeSubscriberReducer(
  state: FinanceSubscriberState,
  message: SettlementBroadcast,
): FinanceSubscriberState {
  const { event } = message;
  const current = state.settlements[event.claimKey] ?? createReadySettlementView(event.claimKey);
  return {
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
