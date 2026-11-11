'use client';

import { useEffect, useMemo, useReducer } from 'react';
import { reconcileClauseClock } from '../../src/core/clause-clock-engine.ts';
import type { ClauseClockScenario } from '../../src/core/clause-clock-types.ts';
import { ChronographSubdials } from './chronograph-subdials.tsx';
import { EdgeCaseBanners } from './edge-case-banners.tsx';
import type { ClauseClockHostPort, SkillContractSnapshot } from './host-port.ts';
import { IntervalInputs } from './interval-inputs.tsx';
import { IntervalWaterfall } from './interval-waterfall.tsx';
import { JudgeChecklistBar } from './judge-checklist-bar.tsx';
import { McpInspector } from './mcp-inspector.tsx';
import type { ReceiptExportKind } from './receipt-markdown.ts';
import { ReceiptExports } from './receipt-exports.tsx';
import { ScenarioSelector } from './scenario-selector.tsx';
import { SettlementSplitView } from './settlement-split-view.tsx';
import { selectClaimSettlement, type SettlementMap } from './settlement-sync.ts';
import { StudioCaseback, StudioErrorBanner, StudioFooter, StudioHeader } from './studio-chrome.tsx';
import { VendorApportionmentTable } from './vendor-apportionment-table.tsx';
import { buildIntervalWaterfall } from './waterfall-model.ts';
import {
  createInitialWorkbenchState,
  runCommitCommand,
  runCopyExportCommand,
  runResetCommand,
  selectCommitGate,
  selectMcpDefaultArguments,
  selectPreviewReceipt,
  selectScenario,
  selectTimezoneOptions,
  workbenchReducer,
} from './workbench-controller.ts';

export interface ClauseClockWorkbenchProps {
  hostPort: ClauseClockHostPort;
  scenariosById?: Readonly<Record<string, ClauseClockScenario>>;
  initialScenarioId?: string;
  initialSkillContract?: SkillContractSnapshot | null;
  initialSettlements?: SettlementMap;
}

interface WorkbenchSeed {
  scenarioId: string | undefined;
  settlements: SettlementMap | undefined;
}

function seedWorkbench({ scenarioId, settlements }: WorkbenchSeed) {
  return createInitialWorkbenchState(scenarioId, settlements);
}

// Host-agnostic on purpose: everything host-specific arrives through hostPort, so the Next.js studio and a Forge
// Custom UI bundle (jira:issuePanel / jira:globalPage) can mount this exact tree.
export function ClauseClockWorkbench({
  hostPort,
  scenariosById,
  initialScenarioId,
  initialSkillContract = null,
  initialSettlements,
}: ClauseClockWorkbenchProps) {
  const [state, dispatch] = useReducer(
    workbenchReducer,
    { scenarioId: initialScenarioId, settlements: initialSettlements },
    seedWorkbench,
  );
  const { scenarioId, timezoneOverride, disabledIncidentIds, disabledMaintenanceIds } = state;
  const scenario = scenariosById?.[scenarioId] ?? selectScenario(state);
  const preview = useMemo(
    () => scenariosById ? reconcileClauseClock(scenario, {
      timezoneOverride: timezoneOverride ?? undefined,
      disabledIncidentIds: [...disabledIncidentIds], disabledMaintenanceIds: [...disabledMaintenanceIds],
    }) : selectPreviewReceipt({ scenarioId, timezoneOverride, disabledIncidentIds, disabledMaintenanceIds }),
    [scenario, scenariosById, scenarioId, timezoneOverride, disabledIncidentIds, disabledMaintenanceIds],
  );
  const waterfall = useMemo(() => buildIntervalWaterfall(scenario, preview), [scenario, preview]);
  const mcpDefaultArguments = useMemo(
    () =>
      selectMcpDefaultArguments(
        { scenarioId, timezoneOverride, disabledIncidentIds, disabledMaintenanceIds },
        preview.proposalVersionKey,
      ),
    [scenarioId, timezoneOverride, disabledIncidentIds, disabledMaintenanceIds, preview.proposalVersionKey],
  );
  const timezoneOptions = selectTimezoneOptions(scenario);
  const settlement = selectClaimSettlement(state, preview.claimKey);
  const gate = selectCommitGate(state, preview);
  const exportReceipt =
    settlement.status === 'SETTLED' && settlement.settledReceipt ? settlement.settledReceipt : preview;
  const contractTimezoneMissing = !scenario.contract.billingTimezone?.trim();

  useEffect(
    () => hostPort.subscribeSettlementChannel((message) => dispatch({ type: 'SETTLEMENT_BROADCAST', message })),
    [hostPort],
  );

  const commit = async () => {
    dispatch({ type: 'ACTION_STARTED', pendingAction: 'commit' });
    dispatch(await runCommitCommand(hostPort, state));
  };
  const reset = async () => {
    dispatch({ type: 'ACTION_STARTED', pendingAction: 'reset' });
    dispatch(await runResetCommand(hostPort, state));
  };
  const copyExport = async (kind: ReceiptExportKind) => {
    dispatch(await runCopyExportCommand(hostPort, kind, exportReceipt, settlement.status));
  };
  const setTimezone = (value: string | null) => dispatch({ type: 'SET_TIMEZONE', timezoneOverride: value });

  return (
    <div data-testid="clause-clock-workbench" className="@container cc-dial-surface cc-grain min-h-dvh text-ink">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-6 px-4 py-6 @3xl:gap-8 @3xl:px-8 @3xl:py-10">
        <StudioHeader hostLabel={hostPort.hostLabel} />
        <JudgeChecklistBar completedSteps={state.completedSteps} />

        <div className="grid items-start gap-6 @6xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
          <ScenarioSelector
            selectedScenarioId={scenarioId}
            onSelect={(nextScenarioId) => dispatch({ type: 'SELECT_SCENARIO', scenarioId: nextScenarioId })}
          />
          <ChronographSubdials receipt={preview} />
        </div>

        <StudioCaseback receipt={preview} />

        {state.errorBanner ? (
          <StudioErrorBanner banner={state.errorBanner} onDismiss={() => dispatch({ type: 'DISMISS_ERROR' })} />
        ) : null}

        <EdgeCaseBanners
          scenario={scenario}
          receipt={preview}
          timezoneOptions={timezoneOptions}
          timezoneOverride={timezoneOverride}
          financeOverrideReason={state.financeOverrideReason}
          onTimezoneChange={setTimezone}
          onFinanceOverrideChange={(reason) => dispatch({ type: 'SET_FINANCE_OVERRIDE', reason })}
        />

        <div className="grid items-start gap-6 @6xl:grid-cols-[minmax(0,1fr)_22rem]">
          <IntervalWaterfall model={waterfall} receipt={preview} provisionalDraft={preview.provisionalDraftMode} />
          <IntervalInputs
            scenario={scenario}
            disabledIncidentIds={disabledIncidentIds}
            disabledMaintenanceIds={disabledMaintenanceIds}
            timezoneOptions={timezoneOptions}
            timezoneOverride={timezoneOverride}
            showTimezoneSwitcher={!contractTimezoneMissing}
            onToggleIncident={(incidentId) => dispatch({ type: 'TOGGLE_INCIDENT', incidentId })}
            onToggleMaintenance={(maintenanceId) => dispatch({ type: 'TOGGLE_MAINTENANCE', maintenanceId })}
            onTimezoneChange={setTimezone}
          />
        </div>

        <div className="grid items-start gap-6 @6xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <VendorApportionmentTable receipt={preview} />
          <ReceiptExports
            receipt={exportReceipt}
            status={settlement.status}
            lastCopied={state.lastCopiedExport}
            onCopy={copyExport}
          />
        </div>

        <SettlementSplitView
          hostPort={hostPort}
          initialSettlements={initialSettlements}
          receipt={preview}
          settlement={settlement}
          approverId={state.approverId}
          approval={state.approval}
          gate={gate}
          resetDisabled={state.pendingAction !== null}
          onApproverChange={(approverId) => dispatch({ type: 'SET_APPROVER', approverId })}
          onApprovalChange={(checked) =>
            dispatch({ type: 'SET_APPROVAL', checked, proposalVersionKey: preview.proposalVersionKey })
          }
          onCommit={commit}
          onReset={reset}
        />

        <McpInspector
          hostPort={hostPort}
          initialSkillContract={initialSkillContract}
          defaultArguments={mcpDefaultArguments}
          onWorkbenchAction={dispatch}
        />

        <StudioFooter receipt={preview} />
      </div>
    </div>
  );
}
