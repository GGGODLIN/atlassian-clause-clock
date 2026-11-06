import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import {
  CLAUSE_CLOCK_SEEDED_SCENARIOS,
  formatMachineReadableFooter,
  getSeededScenario,
  reconcileClauseClock,
} from '../src/core/index.ts';
import {
  buildApprovalToken,
  buildPrunedJiraRestUrl,
  buildTeamworkGraphIncidentQuery,
  checkP4IdempotentCommitAndReset,
  CLAUSE_CLOCK_ACTION_KEYS,
  createClauseClockStore,
  executeClauseClockAction,
  loadScenarioWithFallback,
  validateForgeManifestAndSkillContract,
} from '../src/actions/index.ts';
import {
  GET as getClauseClockApi,
  POST as postClauseClockApi,
} from '../app/api/clause-clock/route.ts';
import {
  GET as getMcpApi,
  POST as postMcpApi,
} from '../app/api/mcp/route.ts';

const RECEIPT_FOOTER_PATTERN =
  /^\[ClauseClock Receipt #[A-Z0-9-]+ \| issue=[A-Z0-9-]+ \| month=\d{4}-\d{2} \([^)]+\) \| mode=(?:LIVE|SEEDED) \| netOutage=\d+m \| credit=\$\d+\.\d{2} \| vendorSplit=\$\d+\.\d{2} vendor \/ \$\d+\.\d{2} internal\]$/;

test('Role 1.1: formatMachineReadableFooter and executeClauseClockAction append the mandatory machine-readable receipt footer across all 4 actions', () => {
  const store = createClauseClockStore();
  const hero = getSeededScenario('hero-overlap-splicer');
  const receipt = reconcileClauseClock(hero);

  assert.equal(
    receipt.machineReadableFooter,
    '[ClauseClock Receipt #RCPT-JSM-402-2026-11-NET75M | issue=JSM-402 | month=2026-11 (America/New_York) | mode=SEEDED | netOutage=75m | credit=$1500.00 | vendorSplit=$900.00 vendor / $600.00 internal]',
  );
  assert.equal(formatMachineReadableFooter(receipt), receipt.machineReadableFooter);
  assert.match(receipt.machineReadableFooter, RECEIPT_FOOTER_PATTERN);

  // 1. evaluate-clause-clock
  const evalRes = executeClauseClockAction(store, 'evaluate-clause-clock', {
    scenarioId: 'hero-overlap-splicer',
  });
  assert.equal(evalRes.status, 200);
  assert.equal(evalRes.ok, true);
  assert.equal(evalRes.actionKey, 'evaluate-clause-clock');
  assert.equal(evalRes.settlementStatus, 'READY');
  assert.equal(evalRes.receipt?.proposalVersionKey, receipt.proposalVersionKey);
  assert.match(evalRes.machineReadableFooter, RECEIPT_FOOTER_PATTERN);
  assert.equal(
    evalRes.approvalTokenTemplate,
    `APPROVAL::${receipt.proposalVersionKey}::<approverId>`,
  );

  // 2. run-pbt-audit
  const pbtRes = executeClauseClockAction(store, 'run-pbt-audit', {
    numRuns: 25,
    seed: 20261106,
  });
  assert.equal(pbtRes.status, 200);
  assert.equal(pbtRes.ok, true);
  assert.equal(pbtRes.actionKey, 'run-pbt-audit');
  assert.equal(pbtRes.pbtAuditReport?.passed, true);
  assert.deepEqual(pbtRes.pbtAuditReport?.invariants, {
    P1: true,
    P2: true,
    P3: true,
    P4: true,
  });
  assert.match(pbtRes.machineReadableFooter, RECEIPT_FOOTER_PATTERN);

  // 3. commit-credit-settlement
  const token = buildApprovalToken(receipt.proposalVersionKey, 'USR-FIN-LEAD');
  const commitRes = executeClauseClockAction(store, 'commit-credit-settlement', {
    scenarioId: 'hero-overlap-splicer',
    expectedProposalVersionKey: receipt.proposalVersionKey,
    approverId: 'USR-FIN-LEAD',
    approvalToken: token,
  });
  assert.equal(commitRes.status, 200);
  assert.equal(commitRes.ok, true);
  assert.equal(commitRes.actionKey, 'commit-credit-settlement');
  assert.equal(commitRes.settlementStatus, 'SETTLED');
  assert.equal(commitRes.idempotentReplay, false);
  assert.match(commitRes.machineReadableFooter, RECEIPT_FOOTER_PATTERN);

  // 4. reset-settlement-state
  const resetRes = executeClauseClockAction(store, 'reset-settlement-state', {
    scenarioId: 'hero-overlap-splicer',
  });
  assert.equal(resetRes.status, 200);
  assert.equal(resetRes.ok, true);
  assert.equal(resetRes.actionKey, 'reset-settlement-state');
  assert.equal(resetRes.settlementStatus, 'READY');
  assert.match(resetRes.machineReadableFooter, RECEIPT_FOOTER_PATTERN);
});

test('Role 1.2: commit-credit-settlement enforces 400 MISSING_HUMAN_APPROVAL_TOKEN, 400 UNAPPROVED_CONTRACT_DRAFT, and 409 STALE_PROPOSAL_VERSION_KEY with zero state mutation on rejection', () => {
  const store = createClauseClockStore();

  // Pre-seed a committed scenario (monthly-cap-truncation / JSM-425) in the store so negative mutation assertions are non-vacuous
  const preSeededEval = executeClauseClockAction(store, 'evaluate-clause-clock', {
    scenarioId: 'monthly-cap-truncation',
  });
  const preSeededKey = preSeededEval.receipt!.proposalVersionKey;
  const preSeededCommit = executeClauseClockAction(store, 'commit-credit-settlement', {
    scenarioId: 'monthly-cap-truncation',
    expectedProposalVersionKey: preSeededKey,
    approverId: 'USR-SEED-CONTROL',
    approvalToken: buildApprovalToken(preSeededKey, 'USR-SEED-CONTROL'),
  });
  // Positive control: valid commit mutates notes, properties, KVS, and realtime events
  assert.equal(preSeededCommit.status, 200);
  assert.equal(store.jsmInternalNotes.length, 1);
  assert.equal(store.jiraEntityProperties.size, 1);
  assert.equal(store.kvsSettlementRecords.size, 1);
  assert.equal(store.realtimeEvents.length, 1);

  const heroEval = executeClauseClockAction(store, 'evaluate-clause-clock', {
    scenarioId: 'hero-overlap-splicer',
  });
  const heroVersionKey = heroEval.receipt!.proposalVersionKey;
  const acmeLedgerBefore = { ...store.capLedger.get('CUST-ACME-01::2026-11')! };

  // Case A: Missing or malformed approval token -> 400 MISSING_HUMAN_APPROVAL_TOKEN
  const missingTokenRes = executeClauseClockAction(store, 'commit-credit-settlement', {
    scenarioId: 'hero-overlap-splicer',
    expectedProposalVersionKey: heroVersionKey,
    approverId: 'USR-FIN-01',
    approvalToken: 'INVALID-TOKEN',
  });
  assert.equal(missingTokenRes.status, 400);
  assert.equal(missingTokenRes.ok, false);
  assert.equal(missingTokenRes.errorCode, 'MISSING_HUMAN_APPROVAL_TOKEN');
  assert.equal(store.jsmInternalNotes.length, 1);
  assert.equal(store.jiraEntityProperties.has('JSM-402::clauseclock.settlement'), false);
  assert.equal(
    store.capLedger.get('CUST-ACME-01::2026-11')?.remainingCapCents,
    acmeLedgerBefore.remainingCapCents,
  );

  // Case B: Stale expectedProposalVersionKey (TOCTOU mismatch when timezone/incident toggles change) -> 409 STALE_PROPOSAL_VERSION_KEY
  const staleVersionRes = executeClauseClockAction(store, 'commit-credit-settlement', {
    scenarioId: 'hero-overlap-splicer',
    disabledIncidentIds: ['INC-902'],
    expectedProposalVersionKey: heroVersionKey,
    approverId: 'USR-FIN-01',
    approvalToken: buildApprovalToken(heroVersionKey, 'USR-FIN-01'),
  });
  assert.equal(staleVersionRes.status, 409);
  assert.equal(staleVersionRes.ok, false);
  assert.equal(staleVersionRes.errorCode, 'STALE_PROPOSAL_VERSION_KEY');
  assert.notEqual(staleVersionRes.currentProposalVersionKey, heroVersionKey);
  assert.equal(store.jsmInternalNotes.length, 1);
  assert.equal(store.jiraEntityProperties.has('JSM-402::clauseclock.settlement'), false);

  // Case C: Unapproved DRAFT contract without financeOverrideReason -> 400 UNAPPROVED_CONTRACT_DRAFT
  const draftEval = executeClauseClockAction(store, 'evaluate-clause-clock', {
    scenarioId: 'unapproved-contract-draft',
  });
  const draftKey = draftEval.receipt!.proposalVersionKey;
  const draftRejectRes = executeClauseClockAction(store, 'commit-credit-settlement', {
    scenarioId: 'unapproved-contract-draft',
    expectedProposalVersionKey: draftKey,
    approverId: 'USR-FIN-01',
    approvalToken: buildApprovalToken(draftKey, 'USR-FIN-01'),
  });
  assert.equal(draftRejectRes.status, 400);
  assert.equal(draftRejectRes.ok, false);
  assert.equal(draftRejectRes.errorCode, 'UNAPPROVED_CONTRACT_DRAFT');
  assert.equal(store.jsmInternalNotes.length, 1);
  assert.equal(store.jiraEntityProperties.has('JSM-439::clauseclock.settlement'), false);

  // Positive control for DRAFT contract: providing financeOverrideReason succeeds
  const draftApproveRes = executeClauseClockAction(store, 'commit-credit-settlement', {
    scenarioId: 'unapproved-contract-draft',
    expectedProposalVersionKey: draftKey,
    approverId: 'USR-FIN-01',
    approvalToken: buildApprovalToken(draftKey, 'USR-FIN-01'),
    financeOverrideReason: 'VP Finance verbal sign-off on Nova BioLabs Q4 addendum #FIN-882',
  });
  assert.equal(draftApproveRes.status, 200);
  assert.equal(draftApproveRes.ok, true);
  assert.equal(draftApproveRes.settlementStatus, 'SETTLED');
  assert.equal(store.jsmInternalNotes.length, 2);
  assert.equal(store.jiraEntityProperties.has('JSM-439::clauseclock.settlement'), true);
});

test('Role 1.3: Atomic settlement write-back updates capLedger, JSM internal note, Jira Entity Property, KVS record, and @forge/realtime event, replays idempotently, and resets cleanly', () => {
  const store = createClauseClockStore();
  const evalRes = executeClauseClockAction(store, 'evaluate-clause-clock', {
    scenarioId: 'hero-overlap-splicer',
  });
  const receipt = evalRes.receipt!;
  const ledgerKey = 'CUST-ACME-01::2026-11';

  assert.equal(store.capLedger.get(ledgerKey)?.priorApprovedCents, 50000);
  assert.equal(store.capLedger.get(ledgerKey)?.committedInSessionCents, 0);
  assert.equal(store.capLedger.get(ledgerKey)?.remainingCapCents, 550000);

  const approvalToken = buildApprovalToken(receipt.proposalVersionKey, 'USR-APPROVER-99');
  const firstCommit = executeClauseClockAction(store, 'commit-credit-settlement', {
    scenarioId: 'hero-overlap-splicer',
    expectedProposalVersionKey: receipt.proposalVersionKey,
    approverId: 'USR-APPROVER-99',
    approvalToken,
  });

  assert.equal(firstCommit.status, 200);
  assert.equal(firstCommit.ok, true);
  assert.equal(firstCommit.idempotentReplay, false);
  assert.equal(firstCommit.settlementStatus, 'SETTLED');

  // Verify atomic mutations across all 4 persistence/event targets
  const ledgerAfterCommit = store.capLedger.get(ledgerKey)!;
  assert.equal(ledgerAfterCommit.committedInSessionCents, 150000);
  assert.equal(ledgerAfterCommit.priorApprovedCents, 200000);
  assert.equal(ledgerAfterCommit.remainingCapCents, 400000);

  assert.equal(store.jsmInternalNotes.length, 1);
  assert.equal(store.jsmInternalNotes[0]?.claimKey, 'JSM-402');
  assert.equal(store.jsmInternalNotes[0]?.proposalVersionKey, receipt.proposalVersionKey);
  assert.equal(store.jsmInternalNotes[0]?.approverId, 'USR-APPROVER-99');
  assert.ok(store.jsmInternalNotes[0]?.bodyMarkdown.includes('$1500.00'));

  const entityProp = store.jiraEntityProperties.get('JSM-402::clauseclock.settlement');
  assert.ok(entityProp);
  assert.equal(entityProp.proposalVersionKey, receipt.proposalVersionKey);
  assert.equal(entityProp.newCreditCents, 150000);
  assert.equal(entityProp.vendorTotalApportionedCents, 90000);
  assert.equal(entityProp.internalAbsorbedCents, 60000);

  const kvsRecord = store.kvsSettlementRecords.get(
    `settlement::JSM-402::${receipt.proposalVersionKey}`,
  );
  assert.ok(kvsRecord);
  assert.equal(kvsRecord.claimKey, 'JSM-402');
  assert.equal(kvsRecord.receipt.receiptId, receipt.receiptId);

  assert.equal(store.realtimeEvents.length, 1);
  assert.equal(store.realtimeEvents[0]?.channel, 'clause-clock-settlement-sync');
  assert.equal(store.realtimeEvents[0]?.status, 'SETTLED');
  assert.equal(store.realtimeEvents[0]?.claimKey, 'JSM-402');
  assert.equal(store.realtimeEvents[0]?.newCreditCents, 150000);

  // Repeat identical commit -> idempotentReplay: true without double-deducting cap or duplicating notes
  const replayCommit = executeClauseClockAction(store, 'commit-credit-settlement', {
    scenarioId: 'hero-overlap-splicer',
    expectedProposalVersionKey: receipt.proposalVersionKey,
    approverId: 'USR-APPROVER-99',
    approvalToken,
  });
  assert.equal(replayCommit.status, 200);
  assert.equal(replayCommit.ok, true);
  assert.equal(replayCommit.idempotentReplay, true);
  assert.equal(replayCommit.settlementStatus, 'SETTLED');
  assert.equal(store.capLedger.get(ledgerKey)?.committedInSessionCents, 150000);
  assert.equal(store.capLedger.get(ledgerKey)?.remainingCapCents, 400000);
  assert.equal(store.jsmInternalNotes.length, 1);

  // 1-Click Reset -> restores READY and original cap balance
  const resetRes = executeClauseClockAction(store, 'reset-settlement-state', {
    scenarioId: 'hero-overlap-splicer',
  });
  assert.equal(resetRes.status, 200);
  assert.equal(resetRes.ok, true);
  assert.equal(resetRes.settlementStatus, 'READY');
  assert.equal(store.capLedger.get(ledgerKey)?.committedInSessionCents, 0);
  assert.equal(store.capLedger.get(ledgerKey)?.priorApprovedCents, 50000);
  assert.equal(store.capLedger.get(ledgerKey)?.remainingCapCents, 550000);
  assert.equal(store.jsmInternalNotes.length, 0);
  assert.equal(store.jiraEntityProperties.has('JSM-402::clauseclock.settlement'), false);
  assert.equal(
    store.kvsSettlementRecords.has(`settlement::JSM-402::${receipt.proposalVersionKey}`),
    false,
  );
  assert.equal(store.realtimeEvents.length, 2);
  assert.equal(store.realtimeEvents[1]?.status, 'READY');
});

test('Role 1.4: Unknown action names and malformed/non-object payloads fail closed with HTTP 400 without throwing or leaking stack traces', () => {
  const store = createClauseClockStore();

  const unknownRes = executeClauseClockAction(store, 'delete-production-database', {
    scenarioId: 'hero-overlap-splicer',
  });
  assert.equal(unknownRes.status, 400);
  assert.equal(unknownRes.ok, false);
  assert.equal(unknownRes.errorCode, 'UNKNOWN_ACTION_KEY');
  assert.equal('stack' in unknownRes, false);
  assert.match(unknownRes.machineReadableFooter, RECEIPT_FOOTER_PATTERN);

  for (const badPayload of [null, 'raw-string', 42, ['array-payload']]) {
    const malformedRes = executeClauseClockAction(
      store,
      'evaluate-clause-clock',
      badPayload,
    );
    assert.equal(malformedRes.status, 400);
    assert.equal(malformedRes.ok, false);
    assert.equal(malformedRes.errorCode, 'MALFORMED_ACTION_PAYLOAD');
    assert.equal('stack' in malformedRes, false);
    assert.match(malformedRes.machineReadableFooter, RECEIPT_FOOTER_PATTERN);
  }
});

test('Role 1.5: Teamwork Graph & Jira REST query builders enforce first <= 25 and User-field pruning, and loadScenarioWithFallback deterministically falls back to seeded scenarios', async () => {
  // Teamwork Graph query builder enforces first <= 25
  const defaultGraphQuery = buildTeamworkGraphIncidentQuery({
    issueAri: 'ari:cloud:jira:site-1:issue/10402',
  });
  assert.equal(defaultGraphQuery.variables.first, 20);
  assert.ok(defaultGraphQuery.variables.first <= 25);
  assert.ok(defaultGraphQuery.query.includes('requestTeamworkGraph') || defaultGraphQuery.query.includes('linkedIssues'));

  const clampedGraphQuery = buildTeamworkGraphIncidentQuery({
    issueAri: 'ari:cloud:jira:site-1:issue/10402',
    first: 999,
  });
  assert.equal(clampedGraphQuery.variables.first, 25);

  // Pruned Jira REST URL builder enforces explicit fields and forbids User fields (assignee, reporter, creator, watches)
  const prunedUrl = buildPrunedJiraRestUrl({ issueKey: 'JSM-402' });
  assert.ok(prunedUrl.includes('/rest/api/3/issue/JSM-402?fields='));
  const forbiddenUserFields = /(?:^|[,=])(?:assignee|reporter|creator|watches|comment|worklog)(?:[,&]|$)/;
  // Positive control for regex
  assert.match(
    '/rest/api/3/issue/JSM-402?fields=summary,assignee,status',
    forbiddenUserFields,
  );
  assert.doesNotMatch(prunedUrl, forbiddenUserFields);

  // Fallback when no live clients are provided
  const fallbackNoClient = await loadScenarioWithFallback({
    scenarioId: 'monthly-cap-truncation',
  });
  assert.equal(fallbackNoClient.scenario.scenarioId, 'monthly-cap-truncation');
  assert.equal(fallbackNoClient.sourceMode, 'SEEDED_FIXTURE');
  assert.ok(fallbackNoClient.fallbackReason && fallbackNoClient.fallbackReason.length > 0);

  // Fallback when live client throws error
  const fallbackOnError = await loadScenarioWithFallback({
    scenarioId: 'cross-timezone-boundary',
    liveGraphFetcher: async () => {
      throw new Error('403 Forbidden: Teamwork Graph scope unavailable on test site');
    },
  });
  assert.equal(fallbackOnError.scenario.scenarioId, 'cross-timezone-boundary');
  assert.equal(fallbackOnError.sourceMode, 'SEEDED_FIXTURE');
  assert.ok(fallbackOnError.fallbackReason?.includes('403 Forbidden'));

  // Live mode when liveGraphFetcher returns valid scenario data
  const liveLoaded = await loadScenarioWithFallback({
    scenarioId: 'hero-overlap-splicer',
    liveGraphFetcher: async () => getSeededScenario('hero-overlap-splicer'),
  });
  assert.equal(liveLoaded.sourceMode, 'LIVE_GRAPH_AND_REST');
  assert.equal(liveLoaded.fallbackReason, null);
  const liveReceipt = reconcileClauseClock(liveLoaded.scenario, {
    sourceMode: liveLoaded.sourceMode,
    fallbackReason: undefined,
  });
  assert.ok(liveReceipt.machineReadableFooter.includes('mode=LIVE'));
});

test('Role 1.6: validateForgeManifestAndSkillContract verifies manifest.yml, skills/clause-clock/SKILL.md, and TypeScript action registry parity', () => {
  const report = validateForgeManifestAndSkillContract();

  assert.equal(report.valid, true);
  assert.deepEqual(report.errors, []);
  assert.equal(report.hasGraphConnector, false);
  assert.equal(report.singleFunctionHandlerKey, 'clause-clock-action-router');
  assert.deepEqual(report.declaredModules, [
    'jira:issuePanel',
    'jira:globalPage',
    'rovo:agent',
    'rovo:skill',
    'rovo:mcp',
    'action',
    'function',
  ]);
  assert.deepEqual(report.manifestActionKeys, [...CLAUSE_CLOCK_ACTION_KEYS]);
  assert.deepEqual(report.skillAllowedTools, [...CLAUSE_CLOCK_ACTION_KEYS]);
  assert.equal(report.skillName, 'clause-clock');
  assert.deepEqual(report.actionVerbsByKey, {
    'evaluate-clause-clock': 'GET',
    'run-pbt-audit': 'GET',
    'commit-credit-settlement': 'CREATE',
    'reset-settlement-state': 'UPDATE',
  });
});

test('Role 1.7: Next.js /api/clause-clock and /api/mcp routes expose all 4 actions, tools/list, tools/call, and skills/read over HTTP Request/Response', async () => {
  const getRes = await getClauseClockApi(
    new Request('http://localhost:3000/api/clause-clock?scenarioId=hero-overlap-splicer'),
  );
  assert.equal(getRes.status, 200);
  const getJson = await getRes.json();
  assert.equal(getJson.ok, true);
  assert.equal(getJson.receipt.claimKey, 'JSM-402');
  assert.equal(Array.isArray(getJson.scenarios), true);
  assert.equal(getJson.scenarios.length, 4);

  const postEvalRes = await postClauseClockApi(
    new Request('http://localhost:3000/api/clause-clock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actionKey: 'evaluate-clause-clock',
        payload: { scenarioId: 'monthly-cap-truncation' },
      }),
    }),
  );
  assert.equal(postEvalRes.status, 200);
  const postEvalJson = await postEvalRes.json();
  assert.equal(postEvalJson.receipt.claimKey, 'JSM-425');
  assert.match(postEvalJson.machineReadableFooter, RECEIPT_FOOTER_PATTERN);

  // /api/mcp GET returns skill metadata and tool descriptors
  const mcpGetRes = await getMcpApi(new Request('http://localhost:3000/api/mcp'));
  assert.equal(mcpGetRes.status, 200);
  const mcpGetJson = await mcpGetRes.json();
  assert.equal(mcpGetJson.skillName, 'clause-clock');
  assert.equal(mcpGetJson.tools.length, 4);

  // /api/mcp POST tools/list
  const toolsListRes = await postMcpApi(
    new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'tools/list' }),
    }),
  );
  assert.equal(toolsListRes.status, 200);
  const toolsListJson = await toolsListRes.json();
  assert.deepEqual(
    toolsListJson.tools.map((t: { name: string }) => t.name),
    [...CLAUSE_CLOCK_ACTION_KEYS],
  );

  // /api/mcp POST skills/read
  const skillReadRes = await postMcpApi(
    new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'skills/read' }),
    }),
  );
  assert.equal(skillReadRes.status, 200);
  const skillReadJson = await skillReadRes.json();
  assert.ok(skillReadJson.skillMarkdown.includes('name: clause-clock'));

  // /api/mcp POST tools/call
  const toolCallRes = await postMcpApi(
    new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'tools/call',
        params: {
          name: 'evaluate-clause-clock',
          arguments: { scenarioId: 'hero-overlap-splicer' },
        },
      }),
    }),
  );
  assert.equal(toolCallRes.status, 200);
  const toolCallJson = await toolCallRes.json();
  assert.equal(toolCallJson.result.ok, true);
  assert.match(toolCallJson.result.machineReadableFooter, RECEIPT_FOOTER_PATTERN);
});

test('Role 2 & Role 3: P4 Idempotent Commit & Reset Round-Trip holds across randomized commit/replay/reset sequences and detects double-deduction mutations', () => {
  let replayCheckedCount = 0;
  let resetCheckedCount = 0;

  const p4SequenceArb = fc.record({
    scenarioId: fc.constantFrom(
      ...CLAUSE_CLOCK_SEEDED_SCENARIOS.map((s) => s.scenarioId),
    ),
    replayCount: fc.integer({ min: 1, max: 4 }),
    approverSuffix: fc.integer({ min: 100, max: 999 }),
  });

  const p4Property = fc.property(p4SequenceArb, (cfg) => {
    const ok = checkP4IdempotentCommitAndReset({
      scenarioId: cfg.scenarioId,
      replayCount: cfg.replayCount,
      approverId: `USR-PBT-${cfg.approverSuffix}`,
    });
    if (ok) {
      replayCheckedCount += cfg.replayCount;
      resetCheckedCount += 1;
    }
    return ok;
  });

  fc.assert(p4Property, { numRuns: 60, seed: 20261106 });
  assert.ok(replayCheckedCount >= 60);
  assert.ok(resetCheckedCount === 60);

  // Role 3: Negative control — mutating a store to double-deduct on replay or fail to restore remainingCapCents trips P4 check
  const corruptedDoubleDeductDetected = !checkP4IdempotentCommitAndReset({
    scenarioId: 'hero-overlap-splicer',
    replayCount: 2,
    approverId: 'USR-MUTATION-TEST',
    testOnlyCorruptAfterCommit: (store) => {
      const ledger = store.capLedger.get('CUST-ACME-01::2026-11');
      if (ledger) {
        ledger.committedInSessionCents += 150000;
        ledger.remainingCapCents -= 150000;
      }
    },
  });
  assert.equal(corruptedDoubleDeductDetected, true);
});
