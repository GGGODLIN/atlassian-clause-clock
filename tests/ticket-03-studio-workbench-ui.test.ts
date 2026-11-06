import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import {
  CLAUSE_CLOCK_ACTION_KEYS,
  createClauseClockStore,
  executeClauseClockAction,
  getDefaultClauseClockStore,
  readSkillMarkdown,
} from '../src/actions/index.ts';
import {
  GET as getClauseClockApi,
  POST as postClauseClockApi,
} from '../app/api/clause-clock/route.ts';
import { GET as getMcpApi, POST as postMcpApi } from '../app/api/mcp/route.ts';
import {
  createHttpClauseClockHostPort,
  type ClauseClockHostPort,
  type SettlementBroadcast,
  type SkillContractSnapshot,
} from '../app/_studio/host-port.ts';
import {
  createInitialFinanceState,
  financeSubscriberReducer,
  selectFinanceSettlement,
} from '../app/_studio/settlement-sync.ts';
import {
  createInitialWorkbenchState,
  runCommitCommand,
  runCopyExportCommand,
  runResetCommand,
  selectCommitGate,
  selectPreviewReceipt,
  selectSettlementView,
  workbenchReducer,
  type WorkbenchState,
} from '../app/_studio/workbench-controller.ts';

type LoadResult = { format?: string | null; source?: string | ArrayBuffer | Uint8Array | null; shortCircuit?: boolean };
type LoadContext = { format?: string | null };
type LoadHook = (
  url: string,
  context: LoadContext,
  nextLoad: (url: string, context: LoadContext) => LoadResult,
) => LoadResult;

// @types/node 20 lags the Node 24 runtime: module.registerHooks exists at runtime but is missing from the installed typings.
// Node's type stripping refuses .tsx, so the shared workbench components are transpiled with the repo's own TypeScript here.
const { registerHooks } = nodeModule as unknown as {
  registerHooks: (hooks: { load: LoadHook }) => void;
};

registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith('file:') || !url.endsWith('.tsx')) {
      return nextLoad(url, context);
    }
    const fileName = fileURLToPath(url);
    const { outputText } = ts.transpileModule(readFileSync(fileName, 'utf8'), {
      fileName,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        verbatimModuleSyntax: true,
      },
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  },
});

const { ClauseClockWorkbench } = await import('../app/_studio/clause-clock-workbench.tsx');
const { McpExchangeReceipt } = await import('../app/_studio/mcp-inspector.tsx');

const RECEIPT_FOOTER_PATTERN =
  /^\[ClauseClock Receipt #[A-Z0-9-]+ \| issue=[A-Z0-9-]+ \| month=\d{4}-\d{2} \([^)]+\) \| mode=(?:LIVE|SEEDED) \| netOutage=\d+m \| credit=\$\d+\.\d{2} \| vendorSplit=\$\d+\.\d{2} vendor \/ \$\d+\.\d{2} internal\]$/;

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

interface RenderedElement {
  tag: string;
  attributes: Record<string, string>;
  innerHtml: string;
  text: string;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of raw.matchAll(/([^\s="'/]+)(?:="([^"]*)")?/g)) {
    attributes[match[1]!] = decodeEntities(match[2] ?? '');
  }
  return attributes;
}

function extractInnerHtml(html: string, tag: string, from: number): string {
  const tagPattern = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gi');
  tagPattern.lastIndex = from;
  let depth = 1;
  for (let match = tagPattern.exec(html); match; match = tagPattern.exec(html)) {
    if (match[1] === '/') {
      depth -= 1;
      if (depth === 0) {
        return html.slice(from, match.index);
      }
    } else if (match[2] !== '/') {
      depth += 1;
    }
  }
  throw new Error(`unclosed <${tag}> in rendered markup`);
}

function toText(innerHtml: string): string {
  return decodeEntities(innerHtml.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function findAllByTestId(html: string, testId: string): RenderedElement[] {
  const found: RenderedElement[] = [];
  for (const match of html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*?)?(\/?)>/g)) {
    const attributes = parseAttributes(match[2] ?? '');
    if (attributes['data-testid'] !== testId) {
      continue;
    }
    const tag = match[1]!.toLowerCase();
    const innerHtml =
      match[3] === '/' || VOID_TAGS.has(tag)
        ? ''
        : extractInnerHtml(html, tag, match.index! + match[0].length);
    found.push({ tag, attributes, innerHtml, text: toText(innerHtml) });
  }
  return found;
}

function getByTestId(html: string, testId: string): RenderedElement {
  const found = findAllByTestId(html, testId);
  assert.equal(found.length, 1, `expected exactly one [data-testid="${testId}"], found ${found.length}`);
  return found[0]!;
}

const routeToNextHandlers: typeof fetch = async (input, init) => {
  assert.equal(typeof input, 'string', 'the HTTP host port addresses Next.js endpoints by URL string');
  const request = new Request(new URL(String(input), 'http://studio.test'), init);
  const { pathname } = new URL(request.url);
  if (pathname === '/api/clause-clock') {
    return request.method === 'GET' ? getClauseClockApi(request) : postClauseClockApi(request);
  }
  if (pathname === '/api/mcp') {
    return request.method === 'GET' ? getMcpApi(request) : postMcpApi(request);
  }
  return Response.json({ ok: false, message: `no route for ${pathname}` }, { status: 404 });
};

interface StudioHarness {
  port: ClauseClockHostPort;
  clipboardWrites: string[];
}

function createStudioHarness(): StudioHarness {
  const clipboardWrites: string[] = [];
  const port = createHttpClauseClockHostPort({
    fetchImpl: routeToNextHandlers,
    clipboard: {
      writeText: async (text: string) => {
        clipboardWrites.push(text);
      },
    },
    hostLabel: 'Next.js Web Studio (in-process route transport)',
  });
  return { port, clipboardWrites };
}

function resetSharedStore(): void {
  const reset = executeClauseClockAction(getDefaultClauseClockStore(), 'reset-settlement-state', {
    resetAll: true,
  });
  assert.equal(reset.status, 200);
}

function renderWorkbench(
  scenarioId: string,
  port: ClauseClockHostPort = createStudioHarness().port,
  initialSkillContract: SkillContractSnapshot | null = null,
): string {
  return renderToStaticMarkup(
    createElement(ClauseClockWorkbench, {
      hostPort: port,
      initialScenarioId: scenarioId,
      initialSkillContract,
    }),
  );
}

function approve(state: WorkbenchState): WorkbenchState {
  return workbenchReducer(state, {
    type: 'SET_APPROVAL',
    checked: true,
    proposalVersionKey: selectPreviewReceipt(state).proposalVersionKey,
  });
}

function staleCommitRejection(scenarioId: string) {
  const result = executeClauseClockAction(createClauseClockStore(), 'commit-credit-settlement', {
    scenarioId,
    expectedProposalVersionKey: 'CCLOCK-STALE-KEY',
    approverId: 'USR-QA',
    approvalToken: 'APPROVAL::CCLOCK-STALE-KEY::USR-QA',
  });
  assert.equal(result.status, 409);
  return result;
}

function withApprovalAndStaleBanner(state: WorkbenchState): WorkbenchState {
  const rejected = workbenchReducer(state, {
    type: 'ACTION_REJECTED',
    result: staleCommitRejection(state.scenarioId),
  });
  const armed = approve(rejected);
  assert.equal(armed.approval.checked, true);
  assert.equal(armed.approval.proposalVersionKey, selectPreviewReceipt(state).proposalVersionKey);
  assert.equal(armed.errorBanner?.code, 'STALE_PROPOSAL_VERSION_KEY');
  return armed;
}

function assertClearedAndRecomputed(state: WorkbenchState, expectedProposalVersionKey: string): void {
  assert.deepEqual(state.approval, { checked: false, proposalVersionKey: null });
  assert.equal(state.errorBanner, null);
  assert.equal(selectPreviewReceipt(state).proposalVersionKey, expectedProposalVersionKey);
}

test('AC1 (Story 1 & 2): the shared workbench renders the 3-Minute Judge Checklist Bar, the 1-Click Seed 4-Scenario selector, the 5-Track Interval Waterfall beside the naive spreadsheet comparison, and the Upstream Vendor Apportionment table', () => {
  const html = renderWorkbench('hero-overlap-splicer');
  getByTestId(html, 'clause-clock-workbench');

  const checklist = getByTestId(html, 'judge-checklist-bar');
  assert.match(checklist.text, /3-Minute/);
  assert.deepEqual(
    findAllByTestId(checklist.innerHtml, 'judge-checklist-step').map((step) => step.attributes['data-step-id']),
    ['pick-scenario', 'stress-edge-case', 'approve-commit', 'realtime-sync', 'copy-receipt', 'run-mcp-tool', 'reset-demo'],
  );

  const selector = getByTestId(html, 'scenario-selector');
  const options = findAllByTestId(selector.innerHtml, 'scenario-option');
  assert.deepEqual(
    options.map((option) => [option.attributes['data-scenario-id'], option.attributes['aria-pressed']]),
    [
      ['hero-overlap-splicer', 'true'],
      ['cross-timezone-boundary', 'false'],
      ['monthly-cap-truncation', 'false'],
      ['unapproved-contract-draft', 'false'],
    ],
  );
  ['JSM-402', 'JSM-418', 'JSM-425', 'JSM-439'].forEach((claimKey, index) => {
    assert.match(options[index]!.text, new RegExp(claimKey));
  });

  assert.equal(
    getByTestId(html, 'proposal-version-key').text,
    'CCLOCK-JSM-402-2026-11-NET75M-CRED150000-VEND90000',
  );

  const waterfall = getByTestId(html, 'interval-waterfall');
  const tracks = findAllByTestId(waterfall.innerHtml, 'waterfall-track');
  assert.deepEqual(
    tracks.map((track) => [track.attributes['data-track-id'], track.attributes['data-total-minutes']]),
    [
      ['raw-incidents', '120'],
      ['merged-union', '90'],
      ['maintenance-deduction', '15'],
      ['net-outage', '75'],
      ['vendor-overlap', '45'],
    ],
  );
  const segmentSpans = tracks.map((track) =>
    findAllByTestId(track.innerHtml, 'waterfall-segment').map((segment) => [
      Number(segment.attributes['data-start-minute']),
      Number(segment.attributes['data-end-minute']),
    ]),
  );
  assert.deepEqual(segmentSpans, [
    [[600, 660], [630, 690]],
    [[600, 690]],
    [[645, 660]],
    [[600, 645], [660, 690]],
    [[600, 645]],
  ]);

  const naive = getByTestId(waterfall.innerHtml, 'naive-spreadsheet-comparison');
  assert.equal(naive.attributes['data-naive-minutes'], '120');
  assert.equal(naive.attributes['data-naive-credit-cents'], '500000');
  assert.equal(naive.attributes['data-clauseclock-minutes'], '75');
  assert.equal(naive.attributes['data-clauseclock-credit-cents'], '150000');
  assert.match(naive.text, /\$5,000\.00/);
  assert.match(naive.text, /\$1,500\.00/);
  assert.match(naive.text, /\$3,500\.00/);

  const table = getByTestId(html, 'vendor-apportionment-table');
  const vendorRows = findAllByTestId(table.innerHtml, 'vendor-apportionment-row');
  assert.deepEqual(
    vendorRows.map((row) => [
      row.attributes['data-vendor-id'],
      row.attributes['data-overlap-minutes'],
      row.attributes['data-apportioned-cents'],
    ]),
    [['VEND-CLOUD-NET', '45', '90000']],
  );
  assert.match(vendorRows[0]!.text, /CloudEdge Transit/);
  assert.match(vendorRows[0]!.text, /\$900\.00/);
  const internalRow = getByTestId(table.innerHtml, 'internal-absorption-row');
  assert.equal(internalRow.attributes['data-apportioned-cents'], '60000');
  assert.match(internalRow.text, /\$600\.00/);
  const conservation = getByTestId(table.innerHtml, 'cent-conservation-check');
  assert.equal(conservation.attributes['data-balanced'], 'true');
  assert.match(conservation.text, /\$1,500\.00/);
});

test('AC2 (Story 1 & 4, F1): switching scenarios, flipping the billing timezone, or toggling incident/maintenance intervals clears the approval checkbox and stale error banners and recomputes proposalVersionKey through the shared core engine', () => {
  const crossTimezone = createInitialWorkbenchState('cross-timezone-boundary');
  assert.equal(
    selectPreviewReceipt(crossTimezone).proposalVersionKey,
    'CCLOCK-JSM-418-2026-11-NET40M-CRED0-VEND0',
  );
  const losAngeles = workbenchReducer(withApprovalAndStaleBanner(crossTimezone), {
    type: 'SET_TIMEZONE',
    timezoneOverride: 'America/Los_Angeles',
  });
  // Pins the shared engine's current shift sign (offset(contract) − offset(billing)); Ticket 03's Verification Log records
  // that real Los Angeles time would push this incident out of November, so an engine fix must update this key too.
  assertClearedAndRecomputed(losAngeles, 'CCLOCK-JSM-418-2026-11-NET60M-CRED150000-VEND75000');
  const backToFallback = workbenchReducer(withApprovalAndStaleBanner(losAngeles), {
    type: 'SET_TIMEZONE',
    timezoneOverride: null,
  });
  assertClearedAndRecomputed(backToFallback, 'CCLOCK-JSM-418-2026-11-NET40M-CRED0-VEND0');

  const hero = createInitialWorkbenchState('hero-overlap-splicer');
  assert.equal(
    selectPreviewReceipt(hero).proposalVersionKey,
    'CCLOCK-JSM-402-2026-11-NET75M-CRED150000-VEND90000',
  );
  const withoutInc902 = workbenchReducer(withApprovalAndStaleBanner(hero), {
    type: 'TOGGLE_INCIDENT',
    incidentId: 'INC-902',
  });
  assertClearedAndRecomputed(withoutInc902, 'CCLOCK-JSM-402-2026-11-NET45M-CRED150000-VEND150000');
  const withoutChg210 = workbenchReducer(withApprovalAndStaleBanner(hero), {
    type: 'TOGGLE_MAINTENANCE',
    maintenanceId: 'CHG-210',
  });
  assertClearedAndRecomputed(withoutChg210, 'CCLOCK-JSM-402-2026-11-NET90M-CRED150000-VEND75000');

  const switched = workbenchReducer(withApprovalAndStaleBanner(withoutInc902), {
    type: 'SELECT_SCENARIO',
    scenarioId: 'monthly-cap-truncation',
  });
  assertClearedAndRecomputed(switched, 'CCLOCK-JSM-425-2026-11-NET60M-CRED80000-VEND80000');
  assert.deepEqual(switched.disabledIncidentIds, []);
  assert.equal(switched.timezoneOverride, null);
});

test('AC3 (Story 2 & 3): edge-case banners cover the missing timezone switcher, the Provisional Draft Mode commit lock, and the Uncapped vs. Capped badge, and three one-click Markdown exports copy customer, vendor, and Confluence receipts', async () => {
  const hero = renderWorkbench('hero-overlap-splicer');
  const crossTimezone = renderWorkbench('cross-timezone-boundary');
  const capped = renderWorkbench('monthly-cap-truncation');
  const draft = renderWorkbench('unapproved-contract-draft');

  const timezoneBanner = getByTestId(crossTimezone, 'banner-missing-timezone');
  assert.match(timezoneBanner.text, /UTC/);
  assert.match(timezoneBanner.text, /20m/);
  const timezoneOptions = findAllByTestId(timezoneBanner.innerHtml, 'timezone-option');
  assert.deepEqual(
    timezoneOptions.map((option) => [option.attributes['data-timezone'], option.attributes['aria-pressed']]),
    [
      ['UTC', 'true'],
      ['America/Los_Angeles', 'false'],
    ],
  );
  assert.equal(findAllByTestId(hero, 'banner-missing-timezone').length, 0);

  const draftBanner = getByTestId(draft, 'banner-provisional-draft');
  assert.match(draftBanner.text, /Provisional Draft Mode/);
  getByTestId(draftBanner.innerHtml, 'finance-override-input');
  assert.equal('disabled' in getByTestId(draft, 'commit-settlement-button').attributes, true);
  assert.equal(findAllByTestId(hero, 'banner-provisional-draft').length, 0);

  const approvedDraft = approve(
    workbenchReducer(createInitialWorkbenchState('unapproved-contract-draft'), {
      type: 'SET_APPROVER',
      approverId: 'USR-FINANCE-CONTROLLER',
    }),
  );
  assert.deepEqual(selectCommitGate(approvedDraft), {
    canCommit: false,
    blockers: ['FINANCE_OVERRIDE_REQUIRED'],
  });
  const overriddenDraft = workbenchReducer(approvedDraft, {
    type: 'SET_FINANCE_OVERRIDE',
    reason: 'VP Finance sign-off on Nova BioLabs addendum FIN-882',
  });
  assert.deepEqual(selectCommitGate(overriddenDraft), { canCommit: true, blockers: [] });

  const capBadge = getByTestId(capped, 'badge-cap-truncation');
  assert.equal(capBadge.attributes['data-uncapped-cents'], '300000');
  assert.equal(capBadge.attributes['data-capped-cents'], '80000');
  assert.match(capBadge.text, /Uncapped/);
  assert.match(capBadge.text, /\$3,000\.00/);
  assert.match(capBadge.text, /Capped/);
  assert.match(capBadge.text, /\$800\.00/);
  assert.equal(findAllByTestId(hero, 'badge-cap-truncation').length, 0);

  const exportButtons = findAllByTestId(hero, 'receipt-export');
  assert.deepEqual(
    exportButtons.map((button) => button.attributes['data-export-kind']),
    ['customer-credit-receipt', 'vendor-recovery-claim', 'confluence-ledger-row'],
  );
  [/Copy Customer Credit Receipt/, /Copy Vendor Recovery Claim/, /Copy Confluence Ledger Row/].forEach(
    (label, index) => assert.match(exportButtons[index]!.text, label),
  );

  const { port, clipboardWrites } = createStudioHarness();
  const heroReceipt = selectPreviewReceipt(createInitialWorkbenchState('hero-overlap-splicer'));
  for (const kind of ['customer-credit-receipt', 'vendor-recovery-claim', 'confluence-ledger-row'] as const) {
    assert.deepEqual(await runCopyExportCommand(port, kind, heroReceipt, 'READY'), {
      type: 'RECEIPT_COPIED',
      kind,
    });
  }
  assert.equal(clipboardWrites.length, 3);
  const [customerMarkdown, vendorMarkdown, ledgerMarkdown] = clipboardWrites as [string, string, string];

  assert.match(customerMarkdown, /JSM-402/);
  assert.match(customerMarkdown, /Acme Global Retail/);
  assert.match(customerMarkdown, /75m/);
  assert.match(customerMarkdown, /99\.8264%/);
  assert.match(customerMarkdown, /\$1,500\.00/);
  assert.match(customerMarkdown, /RCPT-JSM-402-2026-11-NET75M/);

  assert.match(vendorMarkdown, /CloudEdge Transit/);
  assert.match(vendorMarkdown, /45m/);
  assert.match(vendorMarkdown, /2026-11-01 10:00 → 10:45/);
  assert.match(vendorMarkdown, /\$900\.00/);
  assert.match(vendorMarkdown, /RCPT-JSM-402-2026-11-NET75M/);

  // External documents withhold internal recovery figures; the positive controls prove the same matchers fire on internal text.
  assert.equal(customerMarkdown.includes('$900.00'), false, 'customer receipt leaks the vendor recovery amount');
  assert.equal(customerMarkdown.includes('VEND'), false, 'customer receipt leaks the vendor-bearing proposal key or footer');
  assert.equal(vendorMarkdown.includes('$600.00'), false, 'vendor claim leaks the internal absorption amount');
  assert.equal(heroReceipt.machineReadableFooter.includes('VEND') || heroReceipt.proposalVersionKey.includes('VEND'), true);

  const ledgerLines = ledgerMarkdown.trim().split('\n');
  assert.equal(ledgerLines.length, 3);
  assert.match(ledgerLines[1]!, /^\|(?:\s*:?-{3,}:?\s*\|)+$/);
  const ledgerCells = ledgerLines[2]!.split('|').map((cell) => cell.trim());
  for (const expectedCell of [
    'JSM-402',
    '$1,500.00',
    '$900.00',
    '$600.00',
    'CCLOCK-JSM-402-2026-11-NET75M-CRED150000-VEND90000',
    'READY',
  ]) {
    assert.equal(ledgerCells.includes(expectedCell), true, `ledger row is missing cell ${expectedCell}`);
  }

  const cappedReceipt = selectPreviewReceipt(createInitialWorkbenchState('monthly-cap-truncation'));
  await runCopyExportCommand(port, 'vendor-recovery-claim', cappedReceipt, 'READY');
  const multiVendorClaim = clipboardWrites[3]!;
  assert.match(multiVendorClaim, /AlphaDNS Anycast[\s\S]*\$266\.67/);
  assert.match(multiVendorClaim, /BetaStream Brokers[\s\S]*\$266\.67/);
  assert.match(multiVendorClaim, /GammaStore Cloud[\s\S]*\$266\.66/);
});

test('AC4 (Story 2 & 4, F5): confirming a settlement in the Support view updates the Support panel and the Finance @forge/realtime subscriber with the new CalculationReceipt and SETTLED status, and Reset Demo Write-Back restores READY in both views', async () => {
  resetSharedStore();
  const { port } = createStudioHarness();

  const html = renderWorkbench('hero-overlap-splicer', port);
  assert.match(getByTestId(html, 'support-view').text, /jira:issuePanel/);
  assert.match(getByTestId(html, 'finance-view').text, /@forge\/realtime/);
  assert.equal(getByTestId(html, 'support-settlement-status').attributes['data-status'], 'READY');
  assert.equal(getByTestId(html, 'finance-settlement-status').attributes['data-status'], 'READY');
  assert.match(getByTestId(html, 'reset-demo-writeback-button').text, /Reset Demo Write-Back/);

  let finance = createInitialFinanceState();
  const broadcasts: SettlementBroadcast[] = [];
  const unsubscribe = port.subscribeSettlementChannel((message) => {
    broadcasts.push(message);
    finance = financeSubscriberReducer(finance, message);
  });

  let support = workbenchReducer(createInitialWorkbenchState('hero-overlap-splicer'), {
    type: 'SET_APPROVER',
    approverId: 'USR-SUPPORT-LEAD',
  });
  support = approve(support);
  assert.deepEqual(selectCommitGate(support), { canCommit: true, blockers: [] });

  const commitAction = await runCommitCommand(port, support);
  assert.equal(commitAction.type, 'COMMIT_SETTLED');
  support = workbenchReducer(support, commitAction);

  const supportView = selectSettlementView(support, 'JSM-402');
  assert.equal(supportView.status, 'SETTLED');
  assert.equal(
    supportView.settledReceipt?.proposalVersionKey,
    'CCLOCK-JSM-402-2026-11-NET75M-CRED150000-VEND90000',
  );
  assert.equal(supportView.settledReceipt?.mathBreakdown.newCreditCents, 150000);

  assert.deepEqual(
    broadcasts.map((message) => [message.channel, message.event.claimKey, message.event.status]),
    [['clause-clock-settlement-sync', 'JSM-402', 'SETTLED']],
  );
  const financeView = selectFinanceSettlement(finance, 'JSM-402');
  assert.equal(financeView.status, 'SETTLED');
  assert.equal(financeView.settledReceipt?.receiptId, 'RCPT-JSM-402-2026-11-NET75M');
  assert.equal(financeView.settledReceipt?.mathBreakdown.vendorTotalApportionedCents, 90000);
  assert.equal(financeView.settledReceipt?.mathBreakdown.internalAbsorbedCents, 60000);
  assert.equal(financeView.approverId, 'USR-SUPPORT-LEAD');

  const settledEvaluation = await port.executeAction('evaluate-clause-clock', {
    scenarioId: 'hero-overlap-splicer',
  });
  assert.equal(settledEvaluation.settlementStatus, 'SETTLED');

  const resetAction = await runResetCommand(port, support);
  assert.equal(resetAction.type, 'RESET_COMPLETED');
  support = workbenchReducer(support, resetAction);
  assert.equal(selectSettlementView(support, 'JSM-402').status, 'READY');
  assert.equal(selectSettlementView(support, 'JSM-402').settledReceipt, null);

  assert.deepEqual(
    broadcasts.map((message) => message.event.status),
    ['SETTLED', 'READY'],
  );
  assert.equal(selectFinanceSettlement(finance, 'JSM-402').status, 'READY');
  assert.equal(selectFinanceSettlement(finance, 'JSM-402').settledReceipt, null);

  const resetEvaluation = await port.executeAction('evaluate-clause-clock', {
    scenarioId: 'hero-overlap-splicer',
  });
  assert.equal(resetEvaluation.settlementStatus, 'READY');
  unsubscribe();
});

test('AC5 (Story 2 & 5): the Rovo MCP & SKILL.md Live Inspector shows the live SKILL.md contract and runs all 4 MCP tools against the shared store with JSON request/response receipts and machine-readable footers', async () => {
  resetSharedStore();
  const { port } = createStudioHarness();

  const snapshot = await port.readSkillContract();
  assert.equal(snapshot.skillName, 'clause-clock');
  assert.equal(snapshot.skillMarkdown, readSkillMarkdown());
  assert.equal(snapshot.contractValid, true);
  assert.deepEqual(snapshot.contractErrors, []);
  assert.deepEqual(
    snapshot.tools.map((tool) => [tool.name, tool.actionVerb]),
    [
      ['evaluate-clause-clock', 'GET'],
      ['run-pbt-audit', 'GET'],
      ['commit-credit-settlement', 'CREATE'],
      ['reset-settlement-state', 'UPDATE'],
    ],
  );

  const html = renderWorkbench('hero-overlap-splicer', port, snapshot);
  const inspector = getByTestId(html, 'mcp-inspector');
  assert.match(inspector.text, /Rovo MCP & SKILL\.md Live Inspector/);
  const skillViewer = getByTestId(inspector.innerHtml, 'skill-md-viewer');
  assert.match(skillViewer.text, /name: clause-clock/);
  for (const actionKey of CLAUSE_CLOCK_ACTION_KEYS) {
    assert.match(skillViewer.text, new RegExp(`- ${actionKey}`));
  }
  assert.equal(getByTestId(inspector.innerHtml, 'skill-contract-status').attributes['data-valid'], 'true');
  const toolCards = findAllByTestId(inspector.innerHtml, 'mcp-tool');
  assert.deepEqual(
    toolCards.map((card) => card.attributes['data-tool-name']),
    [...CLAUSE_CLOCK_ACTION_KEYS],
  );
  toolCards.forEach((card) => getByTestId(card.innerHtml, 'mcp-tool-run'));

  const broadcasts: SettlementBroadcast[] = [];
  const unsubscribe = port.subscribeSettlementChannel((message) => broadcasts.push(message));

  const evaluate = await port.callMcpTool('evaluate-clause-clock', { scenarioId: 'hero-overlap-splicer' });
  const pbtAudit = await port.callMcpTool('run-pbt-audit', { numRuns: 25, seed: 20261106 });
  const proposalVersionKey = evaluate.result?.receipt?.proposalVersionKey ?? '';
  assert.equal(proposalVersionKey, 'CCLOCK-JSM-402-2026-11-NET75M-CRED150000-VEND90000');
  const commit = await port.callMcpTool('commit-credit-settlement', {
    scenarioId: 'hero-overlap-splicer',
    expectedProposalVersionKey: proposalVersionKey,
    approverId: 'USR-ROVO-REVIEWER',
    approvalToken: `APPROVAL::${proposalVersionKey}::USR-ROVO-REVIEWER`,
  });

  let workbench = workbenchReducer(createInitialWorkbenchState('hero-overlap-splicer'), {
    type: 'SET_APPROVER',
    approverId: 'USR-ROVO-REVIEWER',
  });
  workbench = approve(workbench);
  const workbenchReplay = await runCommitCommand(port, workbench);
  assert.equal(workbenchReplay.type, 'COMMIT_SETTLED');
  assert.equal(workbenchReplay.type === 'COMMIT_SETTLED' && workbenchReplay.result.idempotentReplay, true);

  const reset = await port.callMcpTool('reset-settlement-state', { scenarioId: 'hero-overlap-splicer' });

  const exchanges = [evaluate, pbtAudit, commit, reset];
  assert.deepEqual(
    exchanges.map((exchange) => [exchange.request.method, exchange.request.params.name, exchange.httpStatus, exchange.result?.ok]),
    CLAUSE_CLOCK_ACTION_KEYS.map((actionKey) => ['tools/call', actionKey, 200, true]),
  );
  for (const exchange of exchanges) {
    assert.match(exchange.machineReadableFooter, RECEIPT_FOOTER_PATTERN);
  }
  assert.equal(pbtAudit.result?.pbtAuditReport?.passed, true);
  assert.equal(commit.result?.settlementStatus, 'SETTLED');
  assert.equal(reset.result?.settlementStatus, 'READY');
  assert.deepEqual(
    broadcasts.map((message) => message.event.status),
    ['SETTLED', 'READY'],
  );

  const receiptHtml = renderToStaticMarkup(createElement(McpExchangeReceipt, { exchange: commit }));
  const requestJson = getByTestId(receiptHtml, 'mcp-request-json');
  assert.deepEqual(JSON.parse(decodeEntities(requestJson.innerHtml)), commit.request);
  const responseJson = getByTestId(receiptHtml, 'mcp-response-json');
  const renderedResponse = JSON.parse(decodeEntities(responseJson.innerHtml)) as {
    result: { settlementStatus: string };
    content: Array<{ text: string }>;
  };
  assert.equal(renderedResponse.result.settlementStatus, 'SETTLED');
  assert.equal(renderedResponse.content[0]!.text.endsWith(commit.machineReadableFooter), true);
  assert.equal(getByTestId(receiptHtml, 'mcp-footer').text, commit.machineReadableFooter);
  unsubscribe();
});
