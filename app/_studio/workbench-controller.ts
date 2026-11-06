import {
  buildApprovalToken,
  type ClauseClockActionResult,
} from '../../src/actions/clause-clock-dispatcher.ts';
import type { SettlementStatus } from '../../src/actions/clause-clock-store.ts';
import { reconcileClauseClock } from '../../src/core/clause-clock-engine.ts';
import { getSeededScenario } from '../../src/core/clause-clock-scenarios.ts';
import type {
  CalculationReceipt,
  ClauseClockScenario,
} from '../../src/core/clause-clock-types.ts';
import type {
  ClauseClockHostPort,
  McpToolExchange,
  SettlementBroadcast,
} from './host-port.ts';
import { buildReceiptExportMarkdown, type ReceiptExportKind } from './receipt-markdown.ts';
import {
  applySettlementBroadcast,
  createReadySettlementView,
  type ClaimSettlementView,
} from './settlement-sync.ts';

export type ChecklistStepId =
  | 'pick-scenario'
  | 'stress-edge-case'
  | 'approve-commit'
  | 'realtime-sync'
  | 'copy-receipt'
  | 'run-mcp-tool'
  | 'reset-demo';

export interface ChecklistStep {
  id: ChecklistStepId;
  title: string;
  hint: string;
}

export const JUDGE_CHECKLIST_STEPS: readonly ChecklistStep[] = [
  { id: 'pick-scenario', title: 'Seed a claim', hint: 'Load one of 4 canonical JSM claims — no site setup.' },
  { id: 'stress-edge-case', title: 'Bend an input', hint: 'Flip the billing timezone or switch an interval off.' },
  { id: 'approve-commit', title: 'Approve & commit', hint: 'Bind the human token to the proposal key, then write back.' },
  { id: 'realtime-sync', title: 'Watch Finance sync', hint: 'The @forge/realtime subscriber receives the settlement.' },
  { id: 'copy-receipt', title: 'Copy a receipt', hint: 'Customer, vendor or Confluence Markdown in one click.' },
  { id: 'run-mcp-tool', title: 'Call an MCP tool', hint: 'Run a Rovo MCP tool and read its JSON receipt.' },
  { id: 'reset-demo', title: 'Reset the demo', hint: 'Roll the write-back back to READY for the next judge.' },
];

// The seeded Meridian claim omits its contract timezone; Los Angeles is the boundary its scenario brief compares against UTC.
const MISSING_TIMEZONE_ALTERNATIVES = ['America/Los_Angeles'] as const;

export type PendingHostAction = 'commit' | 'reset';

export interface WorkbenchErrorBanner {
  code: string;
  httpStatus: number | null;
  message: string;
}

export interface WorkbenchApproval {
  checked: boolean;
  proposalVersionKey: string | null;
}

export interface WorkbenchState {
  scenarioId: string;
  timezoneOverride: string | null;
  disabledIncidentIds: readonly string[];
  disabledMaintenanceIds: readonly string[];
  approverId: string;
  approval: WorkbenchApproval;
  financeOverrideReason: string;
  errorBanner: WorkbenchErrorBanner | null;
  pendingAction: PendingHostAction | null;
  settlements: Readonly<Record<string, ClaimSettlementView>>;
  completedSteps: readonly ChecklistStepId[];
  lastCopiedExport: ReceiptExportKind | null;
}

export type WorkbenchAction =
  | { type: 'SELECT_SCENARIO'; scenarioId: string }
  | { type: 'SET_TIMEZONE'; timezoneOverride: string | null }
  | { type: 'TOGGLE_INCIDENT'; incidentId: string }
  | { type: 'TOGGLE_MAINTENANCE'; maintenanceId: string }
  | { type: 'SET_APPROVER'; approverId: string }
  | { type: 'SET_APPROVAL'; checked: boolean; proposalVersionKey: string }
  | { type: 'SET_FINANCE_OVERRIDE'; reason: string }
  | { type: 'ACTION_STARTED'; pendingAction: PendingHostAction }
  | { type: 'COMMIT_SETTLED'; result: ClauseClockActionResult }
  | { type: 'RESET_COMPLETED'; result: ClauseClockActionResult }
  | { type: 'ACTION_REJECTED'; result: ClauseClockActionResult }
  | { type: 'HOST_FAILED'; message: string }
  | { type: 'SETTLEMENT_BROADCAST'; message: SettlementBroadcast }
  | { type: 'RECEIPT_COPIED'; kind: ReceiptExportKind }
  | { type: 'MCP_TOOL_EXECUTED'; exchange: McpToolExchange }
  | { type: 'DISMISS_ERROR' };

export interface TimezoneOption {
  value: string | null;
  timezone: string;
  label: string;
}

export type CommitBlocker =
  | 'ACTION_IN_FLIGHT'
  | 'ALREADY_SETTLED'
  | 'APPROVER_ID_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'FINANCE_OVERRIDE_REQUIRED';

export interface CommitGate {
  canCommit: boolean;
  blockers: readonly CommitBlocker[];
}

const NO_APPROVAL: WorkbenchApproval = { checked: false, proposalVersionKey: null };

export function createInitialWorkbenchState(scenarioId?: string): WorkbenchState {
  return {
    scenarioId: getSeededScenario(scenarioId).scenarioId,
    timezoneOverride: null,
    disabledIncidentIds: [],
    disabledMaintenanceIds: [],
    approverId: '',
    approval: NO_APPROVAL,
    financeOverrideReason: '',
    errorBanner: null,
    pendingAction: null,
    settlements: {},
    completedSteps: [],
    lastCopiedExport: null,
  };
}

function completeStep(state: WorkbenchState, stepId: ChecklistStepId): WorkbenchState {
  return state.completedSteps.includes(stepId)
    ? state
    : { ...state, completedSteps: [...state.completedSteps, stepId] };
}

// Any input that can move proposalVersionKey voids the human approval and the banner describing the old proposal (F1).
function withFreshInputs(state: WorkbenchState, inputs: Partial<WorkbenchState>): WorkbenchState {
  return { ...state, ...inputs, approval: NO_APPROVAL, errorBanner: null };
}

function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id];
}

function withSettlement(state: WorkbenchState, view: ClaimSettlementView): WorkbenchState {
  return { ...state, settlements: { ...state.settlements, [view.claimKey]: view } };
}

export function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case 'SELECT_SCENARIO':
      return completeStep(
        withFreshInputs(state, {
          scenarioId: getSeededScenario(action.scenarioId).scenarioId,
          timezoneOverride: null,
          disabledIncidentIds: [],
          disabledMaintenanceIds: [],
          financeOverrideReason: '',
        }),
        'pick-scenario',
      );
    case 'SET_TIMEZONE':
      return completeStep(withFreshInputs(state, { timezoneOverride: action.timezoneOverride }), 'stress-edge-case');
    case 'TOGGLE_INCIDENT':
      return completeStep(
        withFreshInputs(state, { disabledIncidentIds: toggleId(state.disabledIncidentIds, action.incidentId) }),
        'stress-edge-case',
      );
    case 'TOGGLE_MAINTENANCE':
      return completeStep(
        withFreshInputs(state, {
          disabledMaintenanceIds: toggleId(state.disabledMaintenanceIds, action.maintenanceId),
        }),
        'stress-edge-case',
      );
    case 'SET_APPROVER':
      return { ...state, approverId: action.approverId, approval: NO_APPROVAL };
    case 'SET_APPROVAL':
      return {
        ...state,
        approval: action.checked ? { checked: true, proposalVersionKey: action.proposalVersionKey } : NO_APPROVAL,
      };
    case 'SET_FINANCE_OVERRIDE':
      return { ...state, financeOverrideReason: action.reason };
    case 'ACTION_STARTED':
      return { ...state, pendingAction: action.pendingAction, errorBanner: null };
    case 'COMMIT_SETTLED': {
      const receipt = action.result.receipt;
      if (!receipt) {
        return { ...state, pendingAction: null };
      }
      const previous = selectSettlementView(state, receipt.claimKey);
      const settled = withSettlement(
        { ...state, pendingAction: null, approval: NO_APPROVAL, errorBanner: null },
        {
          claimKey: receipt.claimKey,
          status: 'SETTLED',
          proposalVersionKey: receipt.proposalVersionKey,
          settledReceipt: receipt,
          approverId: action.result.kvsSettlementRecord?.approverId ?? previous.approverId,
          lastEventId: action.result.realtimeEvent?.eventId ?? previous.lastEventId,
        },
      );
      return completeStep(settled, 'approve-commit');
    }
    case 'RESET_COMPLETED': {
      const claimKey = action.result.receipt?.claimKey ?? selectScenario(state).contract.claimKey;
      const reset = withSettlement(
        { ...state, pendingAction: null, approval: NO_APPROVAL, errorBanner: null },
        {
          ...createReadySettlementView(claimKey),
          proposalVersionKey: action.result.receipt?.proposalVersionKey ?? null,
          lastEventId: action.result.realtimeEvent?.eventId ?? null,
        },
      );
      return completeStep(reset, 'reset-demo');
    }
    case 'ACTION_REJECTED':
      return {
        ...state,
        pendingAction: null,
        approval: action.result.errorCode === 'STALE_PROPOSAL_VERSION_KEY' ? NO_APPROVAL : state.approval,
        errorBanner: {
          code: action.result.errorCode ?? 'ACTION_REJECTED',
          httpStatus: action.result.status,
          message: action.result.message,
        },
      };
    case 'HOST_FAILED':
      return {
        ...state,
        pendingAction: null,
        errorBanner: { code: 'HOST_UNREACHABLE', httpStatus: null, message: action.message },
      };
    case 'SETTLEMENT_BROADCAST': {
      const claimKey = action.message.event.claimKey;
      const synced = withSettlement(
        state,
        applySettlementBroadcast(selectSettlementView(state, claimKey), action.message),
      );
      return action.message.event.status === 'SETTLED' ? completeStep(synced, 'realtime-sync') : synced;
    }
    case 'RECEIPT_COPIED':
      return completeStep({ ...state, lastCopiedExport: action.kind }, 'copy-receipt');
    case 'MCP_TOOL_EXECUTED':
      return completeStep(state, 'run-mcp-tool');
    case 'DISMISS_ERROR':
      return { ...state, errorBanner: null };
  }
}

export function selectScenario(state: WorkbenchState): ClauseClockScenario {
  return getSeededScenario(state.scenarioId);
}

export type PreviewInputs = Pick<
  WorkbenchState,
  'scenarioId' | 'timezoneOverride' | 'disabledIncidentIds' | 'disabledMaintenanceIds'
>;

// Same core engine and options as the dispatcher's evaluate-clause-clock, so the preview key matches what commit re-derives.
export function selectPreviewReceipt(inputs: PreviewInputs): CalculationReceipt {
  return reconcileClauseClock(getSeededScenario(inputs.scenarioId), {
    timezoneOverride: inputs.timezoneOverride ?? undefined,
    disabledIncidentIds: [...inputs.disabledIncidentIds],
    disabledMaintenanceIds: [...inputs.disabledMaintenanceIds],
    sourceMode: 'SEEDED_FIXTURE',
    fallbackReason: 'SEEDED_SCENARIO_ACTIVE',
  });
}

// The commit template deliberately ships without an approval token: an MCP client cannot mint one, a human must.
export function selectMcpDefaultArguments(
  inputs: PreviewInputs,
  proposalVersionKey: string,
): Record<string, Record<string, unknown>> {
  const claimContext: Record<string, unknown> = {
    scenarioId: inputs.scenarioId,
    ...(inputs.timezoneOverride ? { timezoneOverride: inputs.timezoneOverride } : {}),
    ...(inputs.disabledIncidentIds.length > 0 ? { disabledIncidentIds: [...inputs.disabledIncidentIds] } : {}),
    ...(inputs.disabledMaintenanceIds.length > 0
      ? { disabledMaintenanceIds: [...inputs.disabledMaintenanceIds] }
      : {}),
  };
  return {
    'evaluate-clause-clock': claimContext,
    'run-pbt-audit': { numRuns: 50, seed: 20261106 },
    'commit-credit-settlement': {
      ...claimContext,
      expectedProposalVersionKey: proposalVersionKey,
      approverId: 'USR-ROVO-AGENT',
      approvalToken: '',
    },
    'reset-settlement-state': claimContext,
  };
}

export function selectTimezoneOptions(scenario: ClauseClockScenario): TimezoneOption[] {
  const contractTimezone = scenario.contract.billingTimezone?.trim();
  if (!contractTimezone) {
    return [
      { value: null, timezone: 'UTC', label: 'UTC · fallback' },
      ...MISSING_TIMEZONE_ALTERNATIVES.map((timezone) => ({ value: timezone, timezone, label: timezone })),
    ];
  }
  if (contractTimezone === 'UTC') {
    return [{ value: null, timezone: 'UTC', label: 'UTC · contract' }];
  }
  return [
    { value: null, timezone: contractTimezone, label: `${contractTimezone} · contract` },
    { value: 'UTC', timezone: 'UTC', label: 'UTC' },
  ];
}

export function selectSettlementView(state: WorkbenchState, claimKey: string): ClaimSettlementView {
  return state.settlements[claimKey] ?? createReadySettlementView(claimKey);
}

export function selectCommitGate(
  state: WorkbenchState,
  preview: CalculationReceipt = selectPreviewReceipt(state),
): CommitGate {
  const blockers: CommitBlocker[] = [];
  if (state.pendingAction) {
    blockers.push('ACTION_IN_FLIGHT');
  }
  if (selectSettlementView(state, preview.claimKey).status === 'SETTLED') {
    blockers.push('ALREADY_SETTLED');
  }
  if (!state.approverId.trim()) {
    blockers.push('APPROVER_ID_REQUIRED');
  }
  if (!state.approval.checked || state.approval.proposalVersionKey !== preview.proposalVersionKey) {
    blockers.push('APPROVAL_REQUIRED');
  }
  if (preview.provisionalDraftMode && !state.financeOverrideReason.trim()) {
    blockers.push('FINANCE_OVERRIDE_REQUIRED');
  }
  return { canCommit: blockers.length === 0, blockers };
}

function scenarioPayload(state: WorkbenchState): Record<string, unknown> {
  return {
    scenarioId: state.scenarioId,
    timezoneOverride: state.timezoneOverride ?? undefined,
    disabledIncidentIds: [...state.disabledIncidentIds],
    disabledMaintenanceIds: [...state.disabledMaintenanceIds],
  };
}

function describeHostError(error: unknown): string {
  return error instanceof Error ? error.message : 'The ClauseClock host did not answer.';
}

// The token binds the key the human approved, so a server-side drift since approval comes back as 409 instead of committing.
export async function runCommitCommand(
  port: ClauseClockHostPort,
  state: WorkbenchState,
): Promise<WorkbenchAction> {
  const approvedKey = state.approval.proposalVersionKey ?? selectPreviewReceipt(state).proposalVersionKey;
  const approverId = state.approverId.trim();
  try {
    const result = await port.executeAction('commit-credit-settlement', {
      ...scenarioPayload(state),
      expectedProposalVersionKey: approvedKey,
      approverId,
      approvalToken: state.approval.checked && approverId ? buildApprovalToken(approvedKey, approverId) : '',
      financeOverrideReason: state.financeOverrideReason.trim() || undefined,
    });
    return result.ok ? { type: 'COMMIT_SETTLED', result } : { type: 'ACTION_REJECTED', result };
  } catch (error: unknown) {
    return { type: 'HOST_FAILED', message: describeHostError(error) };
  }
}

export async function runResetCommand(
  port: ClauseClockHostPort,
  state: WorkbenchState,
): Promise<WorkbenchAction> {
  try {
    const result = await port.executeAction('reset-settlement-state', scenarioPayload(state));
    return result.ok ? { type: 'RESET_COMPLETED', result } : { type: 'ACTION_REJECTED', result };
  } catch (error: unknown) {
    return { type: 'HOST_FAILED', message: describeHostError(error) };
  }
}

export async function runCopyExportCommand(
  port: ClauseClockHostPort,
  kind: ReceiptExportKind,
  receipt: CalculationReceipt,
  status: SettlementStatus,
): Promise<WorkbenchAction> {
  try {
    await port.copyText(buildReceiptExportMarkdown(kind, receipt, status));
    return { type: 'RECEIPT_COPIED', kind };
  } catch (error: unknown) {
    return { type: 'HOST_FAILED', message: describeHostError(error) };
  }
}

export async function runMcpToolCommand(
  port: ClauseClockHostPort,
  toolName: string,
  args: Record<string, unknown>,
): Promise<WorkbenchAction> {
  try {
    return { type: 'MCP_TOOL_EXECUTED', exchange: await port.callMcpTool(toolName, args) };
  } catch (error: unknown) {
    return { type: 'HOST_FAILED', message: describeHostError(error) };
  }
}
