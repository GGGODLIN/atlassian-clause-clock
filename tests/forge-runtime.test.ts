import assert from 'node:assert/strict';
import test from 'node:test';
import { executeForgeAction, deserializeStore, type ForgeRuntimePort, type StoredAccount } from '../src/forge/forge-runtime.ts';
import { buildApprovalToken } from '../src/actions/clause-clock-dispatcher.ts';
import { getSeededScenario } from '../src/core/clause-clock-scenarios.ts';

function fixture(): { port: ForgeRuntimePort; accounts: Map<string, StoredAccount>; deliveries: string[]; failDelivery: boolean } {
  const accounts = new Map<string, StoredAccount>();
  const state = { accounts, deliveries: [] as string[], failDelivery: false, port: {} as ForgeRuntimePort };
  state.port = {
    loadScenario: async () => null,
    readAccount: async key => structuredClone(accounts.get(key)),
    initializeAccount: async (key, value) => { if (accounts.has(key)) throw new Error('conflict'); accounts.set(key, structuredClone(value)); },
    compareAndSetAccount: async (key, revision, value) => {
      if (accounts.get(key)?.revision !== revision) throw new Error('conflict');
      accounts.set(key, structuredClone(value));
    },
    deliver: async result => { if (state.failDelivery) throw new Error('unavailable'); state.deliveries.push(result.actionKey); },
  };
  return state;
}

test('Forge P4: cold invocation reloads persistent ledger, commits once, retries pending delivery and resets', async () => {
  const state = fixture();
  const evaluated = await executeForgeAction(state.port, 'evaluate-clause-clock', { scenarioId: 'hero-overlap-splicer' });
  assert.equal(evaluated.receipt?.provenance.sourceMode, 'SEEDED_FIXTURE');
  const key = evaluated.receipt!.proposalVersionKey;
  const args = { scenarioId: 'hero-overlap-splicer', expectedProposalVersionKey: key, approverId: 'finance', approvalToken: buildApprovalToken(key, 'finance') };
  state.failDelivery = true;
  const committed = await executeForgeAction(state.port, 'commit-credit-settlement', args);
  assert.equal(committed.deliveryStatus, 'PENDING_RETRY');
  assert.equal(state.deliveries.length, 0);
  state.failDelivery = false;
  const replay = await executeForgeAction({ ...state.port }, 'commit-credit-settlement', args);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.capLedgerEntry?.committedInSessionCents, 150000);
  assert.equal(state.deliveries.length, 1);
  const reset = await executeForgeAction(state.port, 'reset-settlement-state', { scenarioId: 'hero-overlap-splicer' });
  assert.equal(reset.settlementStatus, 'READY');
  assert.equal(reset.capLedgerEntry?.priorApprovedCents, 50000);
  assert.equal(state.deliveries.length, 2);
  assert.equal([...state.accounts.values()][0].pending, null);
});

test('Forge conditional transaction rejects concurrent settlements without losing cap state', async () => {
  const state = fixture();
  const evaluation = await executeForgeAction(state.port, 'evaluate-clause-clock', {});
  const key = evaluation.receipt!.proposalVersionKey;
  const args = { expectedProposalVersionKey: key, approverId: 'finance', approvalToken: buildApprovalToken(key, 'finance') };
  const outcomes = await Promise.allSettled([
    executeForgeAction(state.port, 'commit-credit-settlement', args),
    executeForgeAction(state.port, 'commit-credit-settlement', args),
  ]);
  assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(value => value.status === 'rejected').length, 1);
  const stored = deserializeStore([...state.accounts.values()][0].snapshot);
  assert.equal(stored.capLedger.get('CUST-ACME-01::2026-11')?.committedInSessionCents, 150000);
});

test('Forge live scenario replaces seed input and cannot be spoofed by payload source labels', async () => {
  const state = fixture();
  const live = structuredClone(getSeededScenario());
  live.contract.claimKey = 'LIVE-1';
  live.incidents = [];
  state.port.loadScenario = async () => live;
  const response = await executeForgeAction(state.port, 'evaluate-clause-clock', { sourceMode: 'SEEDED_FIXTURE' }, 'LIVE-1');
  assert.equal(response.receipt?.claimKey, 'LIVE-1');
  assert.equal(response.receipt?.mathBreakdown.netOutageMinutes, 0);
  assert.equal(response.receipt?.provenance.sourceMode, 'LIVE_GRAPH_AND_REST');
  state.port.loadScenario = async () => null;
  const seed = await executeForgeAction(state.port, 'evaluate-clause-clock', { sourceMode: 'LIVE_GRAPH_AND_REST' });
  assert.equal(seed.receipt?.provenance.sourceMode, 'SEEDED_FIXTURE');
});
