import { createRoot } from 'react-dom/client';
import { ClauseClockWorkbench } from '../app/_studio/clause-clock-workbench.tsx';
import { CLAUSE_CLOCK_SEEDED_SCENARIOS } from '../src/core/clause-clock-scenarios.ts';
import type { ClauseClockScenario } from '../src/core/clause-clock-types.ts';
import type { ForgeActionResponse } from '../src/forge/forge-runtime.ts';
import type { SettlementMap } from '../app/_studio/settlement-sync.ts';
import { createForgeHostPort } from './host.ts';

const root = document.getElementById('root');
if (!root) throw new Error('Forge root element is missing');
const hostPort = createForgeHostPort();
const reactRoot = createRoot(root);
reactRoot.render(<p role="status">Loading ClauseClock ledger…</p>);
try {
  const scenariosById: Record<string, ClauseClockScenario> = {};
  const settlements: Record<string, SettlementMap[string]> = {};
  const results = await Promise.all(CLAUSE_CLOCK_SEEDED_SCENARIOS.map(async seed => ({
    seed,
    result: await hostPort.executeAction('evaluate-clause-clock', { scenarioId: seed.scenarioId }) as ForgeActionResponse,
  })));
  for (const { seed, result } of results) {
    if (!result.ok || !result.scenario || !result.receipt) throw new Error('The Forge ledger could not load a scenario');
    scenariosById[seed.scenarioId] = result.scenario;
    settlements[result.receipt.claimKey] = {
      claimKey: result.receipt.claimKey, status: result.settlementStatus ?? 'READY',
      proposalVersionKey: result.receipt.proposalVersionKey,
      settledReceipt: result.settlementStatus === 'SETTLED' ? result.receipt : null,
      approverId: result.jiraEntityProperty?.approverId ?? null, lastEventId: null,
    };
  }
  reactRoot.render(<ClauseClockWorkbench hostPort={hostPort} scenariosById={scenariosById} initialSettlements={settlements} />);
} catch (error) {
  reactRoot.render(<p role="alert">{error instanceof Error ? error.message : 'Unable to load the Forge ledger'}</p>);
}
