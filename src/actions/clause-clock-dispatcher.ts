import {
  formatMachineReadableFooter,
  reconcileClauseClock,
} from '../core/clause-clock-engine.ts';
import { runClauseClockPbtAudit } from '../core/clause-clock-pbt.ts';
import { getSeededScenario } from '../core/clause-clock-scenarios.ts';
import type {
  AiOverrideAttempt,
  CalculationReceipt,
  ClauseClockPbtAuditReport,
  ClauseClockScenario,
  ClauseClockSourceMode,
} from '../core/clause-clock-types.ts';
import {
  CLAUSE_CLOCK_ACTION_KEYS,
  type CapLedgerEntry,
  type ClauseClockActionKey,
  type ClauseClockStore,
  createClauseClockStore,
  ensureCapLedgerEntry,
  type ForgeRealtimeEvent,
  type JiraEntityPropertyRecord,
  type JsmInternalNote,
  type KvsSettlementRecord,
  type SettlementStatus,
} from './clause-clock-store.ts';

export type ClauseClockErrorCode =
  | 'UNKNOWN_ACTION_KEY'
  | 'MALFORMED_ACTION_PAYLOAD'
  | 'MISSING_HUMAN_APPROVAL_TOKEN'
  | 'UNAPPROVED_CONTRACT_DRAFT'
  | 'STALE_PROPOSAL_VERSION_KEY';

export interface ClauseClockPbtAuditActionReport extends Omit<ClauseClockPbtAuditReport, 'invariants'> {
  invariants: {
    P1: boolean;
    P2: boolean;
    P3: boolean;
    P4: boolean;
  };
}

export interface ClauseClockActionResult {
  status: 200 | 400 | 409;
  ok: boolean;
  actionKey: string;
  errorCode?: ClauseClockErrorCode;
  message: string;
  settlementStatus?: SettlementStatus;
  idempotentReplay?: boolean;
  currentProposalVersionKey?: string;
  expectedProposalVersionKey?: string;
  approvalTokenTemplate?: string;
  receipt?: CalculationReceipt;
  capLedgerEntry?: CapLedgerEntry;
  jsmInternalNote?: JsmInternalNote;
  jiraEntityProperty?: JiraEntityPropertyRecord;
  kvsSettlementRecord?: KvsSettlementRecord;
  realtimeEvent?: ForgeRealtimeEvent;
  pbtAuditReport?: ClauseClockPbtAuditActionReport;
  machineReadableFooter: string;
}

export function buildApprovalToken(
  proposalVersionKey: string,
  approverId: string,
): string {
  return `APPROVAL::${proposalVersionKey.trim()}::${approverId.trim()}`;
}

export function buildTeamworkGraphIncidentQuery(params: {
  issueAri: string;
  first?: number;
}): {
  query: string;
  variables: {
    issueAri: string;
    first: number;
  };
} {
  const requestedFirst =
    typeof params.first === 'number' && Number.isFinite(params.first)
      ? Math.floor(params.first)
      : 20;
  // Teamwork Graph enforces a hard ceiling of first <= 25 per page
  const clampedFirst = Math.min(25, Math.max(1, requestedFirst));

  const query = [
    'query ClauseClockIncidentContext($issueAri: ID!, $first: Int!) {',
    '  requestTeamworkGraph {',
    '    linkedIssues: workItemByAri(ari: $issueAri) {',
    '      ari',
    '      key',
    '      relationships(first: $first) {',
    '        edges {',
    '          node {',
    '            relationshipType',
    '            targetKey',
    '            targetType',
    '          }',
    '        }',
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\n');

  return {
    query,
    variables: {
      issueAri: params.issueAri.trim(),
      first: clampedFirst,
    },
  };
}

export const PRUNED_JIRA_REST_FIELDS = [
  'summary',
  'status',
  'created',
  'resolutiondate',
  'customfield_sla_start',
  'customfield_sla_end',
] as const;

export function buildPrunedJiraRestUrl(params: { issueKey: string }): string {
  const safeIssueKey = encodeURIComponent(params.issueKey.trim());
  const fieldsParam = PRUNED_JIRA_REST_FIELDS.join(',');
  return `/rest/api/3/issue/${safeIssueKey}?fields=${fieldsParam}`;
}

export async function loadScenarioWithFallback(params: {
  scenarioId?: string;
  claimKey?: string;
  liveGraphFetcher?: () => Promise<ClauseClockScenario | null | undefined>;
}): Promise<{
  scenario: ClauseClockScenario;
  sourceMode: ClauseClockSourceMode;
  fallbackReason: string | null;
}> {
  const lookupKey = params.scenarioId ?? params.claimKey;
  if (typeof params.liveGraphFetcher === 'function') {
    try {
      const liveScenario = await params.liveGraphFetcher();
      if (liveScenario && typeof liveScenario === 'object' && liveScenario.contract) {
        return {
          scenario: {
            ...liveScenario,
            sourceMode: 'LIVE_GRAPH_AND_REST',
            fallbackReason: undefined,
          },
          sourceMode: 'LIVE_GRAPH_AND_REST',
          fallbackReason: null,
        };
      }
      const seededEmptyFallback = getSeededScenario(lookupKey);
      const emptyReason =
        'LIVE_TEAMWORK_GRAPH_RETURNED_EMPTY_DEFAULTED_TO_SEEDED_SCENARIO';
      return {
        scenario: {
          ...seededEmptyFallback,
          sourceMode: 'SEEDED_FIXTURE',
          fallbackReason: emptyReason,
        },
        sourceMode: 'SEEDED_FIXTURE',
        fallbackReason: emptyReason,
      };
    } catch (error: unknown) {
      const errMessage =
        error instanceof Error
          ? error.message
          : 'Unknown Teamwork Graph / Jira REST error';
      const seededErrorFallback = getSeededScenario(lookupKey);
      const fallbackReason = `LIVE_FETCH_FAILED (${errMessage}); DEFAULTED_TO_SEEDED_SCENARIO`;
      return {
        scenario: {
          ...seededErrorFallback,
          sourceMode: 'SEEDED_FIXTURE',
          fallbackReason,
        },
        sourceMode: 'SEEDED_FIXTURE',
        fallbackReason,
      };
    }
  }

  const seeded = getSeededScenario(lookupKey);
  const defaultReason =
    'NO_LIVE_FORGE_GRAPH_CONTEXT_DEFAULTED_TO_SEEDED_SCENARIO';
  return {
    scenario: {
      ...seeded,
      sourceMode: 'SEEDED_FIXTURE',
      fallbackReason: defaultReason,
    },
    sourceMode: 'SEEDED_FIXTURE',
    fallbackReason: defaultReason,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidActionKey(value: unknown): value is ClauseClockActionKey {
  return (
    typeof value === 'string' &&
    (CLAUSE_CLOCK_ACTION_KEYS as readonly string[]).includes(value)
  );
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function extractAiOverrideAttempt(value: unknown): AiOverrideAttempt | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  return {
    monthlyFeeCents:
      typeof value.monthlyFeeCents === 'number' ? value.monthlyFeeCents : undefined,
    newCreditCents:
      typeof value.newCreditCents === 'number' ? value.newCreditCents : undefined,
    creditBps: typeof value.creditBps === 'number' ? value.creditBps : undefined,
    reason: typeof value.reason === 'string' ? value.reason : undefined,
  };
}

function evaluateScenarioAgainstStore(
  store: ClauseClockStore,
  payload: Record<string, unknown>,
): {
  scenario: ClauseClockScenario;
  receipt: CalculationReceipt;
  ledgerEntry: CapLedgerEntry;
} {
  const scenarioIdOrClaimKey =
    typeof payload.scenarioId === 'string' && payload.scenarioId.trim()
      ? payload.scenarioId.trim()
      : typeof payload.claimKey === 'string' && payload.claimKey.trim()
        ? payload.claimKey.trim()
        : undefined;

  const baseScenario = getSeededScenario(scenarioIdOrClaimKey);
  const ledgerEntry = ensureCapLedgerEntry(store, baseScenario);
  const claimKey = baseScenario.contract.claimKey;

  let otherClaimsCommittedCents = 0;
  for (const [otherClaimKey, record] of Object.entries(
    ledgerEntry.committedByClaimKey,
  )) {
    if (otherClaimKey !== claimKey) {
      otherClaimsCommittedCents += record.committedCents;
    }
  }

  const effectiveScenario: ClauseClockScenario = {
    ...baseScenario,
    contract: {
      ...baseScenario.contract,
      priorApprovedCents:
        ledgerEntry.initialPriorApprovedCents + otherClaimsCommittedCents,
    },
  };

  const timezoneOverride =
    typeof payload.timezoneOverride === 'string' && payload.timezoneOverride.trim()
      ? payload.timezoneOverride.trim()
      : undefined;
  const disabledIncidentIds = toStringArray(payload.disabledIncidentIds);
  const disabledMaintenanceIds = toStringArray(payload.disabledMaintenanceIds);
  const aiOverrideAttempt = extractAiOverrideAttempt(payload.aiOverrideAttempt);
  const sourceMode: ClauseClockSourceMode =
    payload.sourceMode === 'LIVE_GRAPH_AND_REST'
      ? 'LIVE_GRAPH_AND_REST'
      : 'SEEDED_FIXTURE';
  const fallbackReason =
    typeof payload.fallbackReason === 'string'
      ? payload.fallbackReason
      : sourceMode === 'SEEDED_FIXTURE'
        ? 'SEEDED_SCENARIO_ACTIVE'
        : undefined;

  const receipt = reconcileClauseClock(effectiveScenario, {
    timezoneOverride,
    disabledIncidentIds,
    disabledMaintenanceIds,
    aiOverrideAttempt,
    sourceMode,
    fallbackReason,
  });

  return {
    scenario: effectiveScenario,
    receipt,
    ledgerEntry,
  };
}

function buildJsmSettlementNoteMarkdown(params: {
  receipt: CalculationReceipt;
  approverId: string;
  financeOverrideReason: string | null;
}): string {
  const { receipt, approverId, financeOverrideReason } = params;
  const vendorLines =
    receipt.vendorApportionments.length > 0
      ? receipt.vendorApportionments
          .map(
            (v) =>
              `- **${v.vendorName}** (\`${v.vendorId}\` / \`${v.componentKey}\`): ${v.overlapMinutes}m overlap (${(v.shareBps / 100).toFixed(2)}%) -> **$${(v.apportionedCents / 100).toFixed(2)}** (${v.apportionedCents} cents)`,
          )
          .join('\n')
      : '- No upstream vendor overlap windows matched.';

  const lines = [
    `### ClauseClock Deterministic SLA Credit Settlement Receipt`,
    `- **Receipt ID**: \`${receipt.receiptId}\``,
    `- **Proposal Version Key**: \`${receipt.proposalVersionKey}\``,
    `- **Claim / Customer**: \`${receipt.claimKey}\` · ${receipt.customerName} (\`${receipt.customerId}\`)`,
    `- **Billing Window**: \`${receipt.billingMonth}\` (\`${receipt.billingTimezone}\`)`,
    `- **Net Billable Outage**: **${receipt.mathBreakdown.netOutageMinutes}m** (Raw ${receipt.mathBreakdown.rawIncidentMinutes}m -> Merged ${receipt.mathBreakdown.mergedIncidentMinutes}m minus ${receipt.mathBreakdown.maintenanceDeductedMinutes}m Maintenance)`,
    `- **Approved Customer Credit**: **$${(receipt.mathBreakdown.newCreditCents / 100).toFixed(2)}** (${receipt.mathBreakdown.newCreditCents} cents · Tier \`${receipt.mathBreakdown.matchedTier.label}\`)`,
    `- **Liability Split**: **$${(receipt.mathBreakdown.vendorTotalApportionedCents / 100).toFixed(2)}** Upstream Vendor Recovery / **$${(receipt.mathBreakdown.internalAbsorbedCents / 100).toFixed(2)}** Internal Absorption`,
    `- **Approved By**: \`${approverId}\``,
    ...(financeOverrideReason
      ? [`- **Finance Draft Override**: ${financeOverrideReason}`]
      : []),
    ``,
    `#### Upstream Vendor Recovery Apportionment`,
    vendorLines,
    ``,
    receipt.machineReadableFooter,
  ];

  return lines.join('\n');
}

export function checkP4IdempotentCommitAndReset(params?: {
  scenarioId?: string;
  replayCount?: number;
  approverId?: string;
  testOnlyCorruptAfterCommit?: (store: ClauseClockStore) => void;
}): boolean {
  const store = createClauseClockStore();
  const scenarioId = params?.scenarioId ?? 'hero-overlap-splicer';
  const replayCount = Math.max(1, Math.min(10, Math.floor(params?.replayCount ?? 2)));
  const approverId = params?.approverId ?? 'USR-PBT-AUDITOR';

  const evalRes = executeClauseClockAction(store, 'evaluate-clause-clock', {
    scenarioId,
  });
  if (!evalRes.ok || evalRes.status !== 200 || !evalRes.receipt) {
    return false;
  }

  const receipt = evalRes.receipt;
  const ledgerKey = `${receipt.customerId}::${receipt.billingMonth}`;
  const ledgerBefore = store.capLedger.get(ledgerKey);
  if (!ledgerBefore) {
    return false;
  }

  const initialPriorApprovedCents = ledgerBefore.initialPriorApprovedCents;
  const initialRemainingCapCents = ledgerBefore.remainingCapCents;
  const expectedNewCreditCents = receipt.mathBreakdown.newCreditCents;
  const expectedRemainingAfterCommit = Math.max(
    0,
    initialRemainingCapCents - expectedNewCreditCents,
  );

  const approvalToken = buildApprovalToken(receipt.proposalVersionKey, approverId);
  const financeOverrideReason = receipt.provisionalDraftMode
    ? 'PBT automated draft override check'
    : undefined;

  const firstCommit = executeClauseClockAction(store, 'commit-credit-settlement', {
    scenarioId,
    expectedProposalVersionKey: receipt.proposalVersionKey,
    approverId,
    approvalToken,
    financeOverrideReason,
  });

  if (
    !firstCommit.ok ||
    firstCommit.status !== 200 ||
    firstCommit.idempotentReplay !== false ||
    firstCommit.settlementStatus !== 'SETTLED'
  ) {
    return false;
  }

  if (params?.testOnlyCorruptAfterCommit) {
    params.testOnlyCorruptAfterCommit(store);
  }

  for (let i = 0; i < replayCount; i += 1) {
    const replayRes = executeClauseClockAction(store, 'commit-credit-settlement', {
      scenarioId,
      expectedProposalVersionKey: receipt.proposalVersionKey,
      approverId,
      approvalToken,
      financeOverrideReason,
    });
    const ledgerDuringReplay = store.capLedger.get(ledgerKey);
    if (
      !replayRes.ok ||
      replayRes.status !== 200 ||
      replayRes.idempotentReplay !== true ||
      replayRes.settlementStatus !== 'SETTLED' ||
      !ledgerDuringReplay ||
      ledgerDuringReplay.committedInSessionCents !== expectedNewCreditCents ||
      ledgerDuringReplay.remainingCapCents !== expectedRemainingAfterCommit ||
      store.jsmInternalNotes.length !== 1
    ) {
      return false;
    }
  }

  const resetRes = executeClauseClockAction(store, 'reset-settlement-state', {
    scenarioId,
  });
  const ledgerAfterReset = store.capLedger.get(ledgerKey);

  if (
    !resetRes.ok ||
    resetRes.status !== 200 ||
    resetRes.settlementStatus !== 'READY' ||
    !ledgerAfterReset ||
    ledgerAfterReset.committedInSessionCents !== 0 ||
    ledgerAfterReset.priorApprovedCents !== initialPriorApprovedCents ||
    ledgerAfterReset.remainingCapCents !== initialRemainingCapCents ||
    store.jsmInternalNotes.length !== 0 ||
    store.jiraEntityProperties.has(`${receipt.claimKey}::clauseclock.settlement`) ||
    store.kvsSettlementRecords.has(
      `settlement::${receipt.claimKey}::${receipt.proposalVersionKey}`,
    )
  ) {
    return false;
  }

  return true;
}

export function executeClauseClockAction(
  store: ClauseClockStore,
  actionKey: unknown,
  payload: unknown,
): ClauseClockActionResult {
  const defaultReceipt = reconcileClauseClock(getSeededScenario());

  if (!isValidActionKey(actionKey)) {
    return {
      status: 400,
      ok: false,
      actionKey: String(actionKey ?? ''),
      errorCode: 'UNKNOWN_ACTION_KEY',
      message: `Unknown ClauseClock action key "${String(actionKey ?? '')}". Allowed actions: ${CLAUSE_CLOCK_ACTION_KEYS.join(', ')}.`,
      machineReadableFooter: defaultReceipt.machineReadableFooter,
    };
  }

  if (!isPlainRecord(payload)) {
    return {
      status: 400,
      ok: false,
      actionKey,
      errorCode: 'MALFORMED_ACTION_PAYLOAD',
      message: `Malformed payload for action "${actionKey}": expected a non-null JSON object.`,
      machineReadableFooter: defaultReceipt.machineReadableFooter,
    };
  }

  if (actionKey === 'evaluate-clause-clock') {
    const { receipt, ledgerEntry } = evaluateScenarioAgainstStore(store, payload);
    const settlementStatus =
      store.settlementStatusByClaimKey.get(receipt.claimKey) ?? 'READY';
    return {
      status: 200,
      ok: true,
      actionKey,
      message: `Evaluated ${receipt.claimKey} (${receipt.scenarioId}): netOutage=${receipt.mathBreakdown.netOutageMinutes}m, newCreditCents=${receipt.mathBreakdown.newCreditCents}.`,
      settlementStatus,
      approvalTokenTemplate: `APPROVAL::${receipt.proposalVersionKey}::<approverId>`,
      receipt,
      capLedgerEntry: { ...ledgerEntry },
      machineReadableFooter: receipt.machineReadableFooter,
    };
  }

  if (actionKey === 'run-pbt-audit') {
    const numRuns =
      typeof payload.numRuns === 'number' && Number.isFinite(payload.numRuns)
        ? payload.numRuns
        : undefined;
    const seed =
      typeof payload.seed === 'number' && Number.isFinite(payload.seed)
        ? payload.seed
        : undefined;

    const baseReport = runClauseClockPbtAudit({ numRuns, seed });
    const p4Passed =
      checkP4IdempotentCommitAndReset({
        scenarioId: 'hero-overlap-splicer',
        replayCount: 2,
      }) &&
      checkP4IdempotentCommitAndReset({
        scenarioId: 'unapproved-contract-draft',
        replayCount: 2,
      });

    const pbtAuditReport: ClauseClockPbtAuditActionReport = {
      ...baseReport,
      passed: baseReport.passed && p4Passed,
      invariants: {
        ...baseReport.invariants,
        P4: p4Passed,
      },
    };

    const { receipt } = evaluateScenarioAgainstStore(store, payload);
    return {
      status: 200,
      ok: true,
      actionKey,
      message: `PBT Audit completed (${pbtAuditReport.numRuns} runs, seed=${pbtAuditReport.seed}): passed=${String(pbtAuditReport.passed)}.`,
      receipt,
      pbtAuditReport,
      machineReadableFooter: formatMachineReadableFooter(receipt),
    };
  }

  if (actionKey === 'commit-credit-settlement') {
    const { receipt, ledgerEntry } = evaluateScenarioAgainstStore(store, payload);
    const currentStatus =
      store.settlementStatusByClaimKey.get(receipt.claimKey) ?? 'READY';

    const expectedProposalVersionKey =
      typeof payload.expectedProposalVersionKey === 'string'
        ? payload.expectedProposalVersionKey.trim()
        : '';

    if (
      !expectedProposalVersionKey ||
      expectedProposalVersionKey !== receipt.proposalVersionKey
    ) {
      return {
        status: 409,
        ok: false,
        actionKey,
        errorCode: 'STALE_PROPOSAL_VERSION_KEY',
        message: `TOCTOU version mismatch for ${receipt.claimKey}: expectedProposalVersionKey "${expectedProposalVersionKey}" does not match current scenario state "${receipt.proposalVersionKey}". Re-evaluate and re-approve before committing.`,
        settlementStatus: currentStatus,
        expectedProposalVersionKey,
        currentProposalVersionKey: receipt.proposalVersionKey,
        receipt,
        capLedgerEntry: { ...ledgerEntry },
        machineReadableFooter: receipt.machineReadableFooter,
      };
    }

    const approverId =
      typeof payload.approverId === 'string' ? payload.approverId.trim() : '';
    const approvalToken =
      typeof payload.approvalToken === 'string' ? payload.approvalToken.trim() : '';
    const requiredToken = approverId
      ? buildApprovalToken(receipt.proposalVersionKey, approverId)
      : '';

    if (!approverId || !approvalToken || approvalToken !== requiredToken) {
      return {
        status: 400,
        ok: false,
        actionKey,
        errorCode: 'MISSING_HUMAN_APPROVAL_TOKEN',
        message: `Commit rejected: missing or invalid human approval token for ${receipt.proposalVersionKey}. Expected format "APPROVAL::${receipt.proposalVersionKey}::<approverId>".`,
        settlementStatus: currentStatus,
        currentProposalVersionKey: receipt.proposalVersionKey,
        approvalTokenTemplate: `APPROVAL::${receipt.proposalVersionKey}::<approverId>`,
        receipt,
        capLedgerEntry: { ...ledgerEntry },
        machineReadableFooter: receipt.machineReadableFooter,
      };
    }

    const financeOverrideReason =
      typeof payload.financeOverrideReason === 'string' &&
      payload.financeOverrideReason.trim().length > 0
        ? payload.financeOverrideReason.trim()
        : null;

    if (receipt.provisionalDraftMode && !financeOverrideReason) {
      return {
        status: 400,
        ok: false,
        actionKey,
        errorCode: 'UNAPPROVED_CONTRACT_DRAFT',
        message: `Commit rejected for ${receipt.claimKey}: contract ${receipt.provenance.contractId} is in DRAFT status (Provisional Draft Mode). Provide a non-empty financeOverrideReason to authorize settlement.`,
        settlementStatus: currentStatus,
        currentProposalVersionKey: receipt.proposalVersionKey,
        receipt,
        capLedgerEntry: { ...ledgerEntry },
        machineReadableFooter: receipt.machineReadableFooter,
      };
    }

    const kvsKey = `settlement::${receipt.claimKey}::${receipt.proposalVersionKey}`;
    const existingKvs = store.kvsSettlementRecords.get(kvsKey);
    if (existingKvs) {
      const existingProp = store.jiraEntityProperties.get(
        `${receipt.claimKey}::clauseclock.settlement`,
      );
      const existingNote = store.jsmInternalNotes.find(
        (n) =>
          n.claimKey === receipt.claimKey &&
          n.proposalVersionKey === receipt.proposalVersionKey,
      );
      return {
        status: 200,
        ok: true,
        actionKey,
        message: `Idempotent replay: ${receipt.claimKey} (${receipt.proposalVersionKey}) is already settled. Monthly cap was not double-deducted.`,
        settlementStatus: 'SETTLED',
        idempotentReplay: true,
        currentProposalVersionKey: receipt.proposalVersionKey,
        receipt: existingKvs.receipt,
        capLedgerEntry: { ...ledgerEntry },
        jsmInternalNote: existingNote,
        jiraEntityProperty: existingProp,
        kvsSettlementRecord: existingKvs,
        machineReadableFooter: existingKvs.receipt.machineReadableFooter,
      };
    }

    const timestampIso = new Date(Date.UTC(2026, 10, 6, 12, 0, 0)).toISOString();

    ledgerEntry.committedByClaimKey[receipt.claimKey] = {
      proposalVersionKey: receipt.proposalVersionKey,
      committedCents: receipt.mathBreakdown.newCreditCents,
    };
    ledgerEntry.settledReceipts[receipt.proposalVersionKey] = receipt;

    let totalSessionCommitted = 0;
    for (const item of Object.values(ledgerEntry.committedByClaimKey)) {
      totalSessionCommitted += item.committedCents;
    }
    ledgerEntry.committedInSessionCents = totalSessionCommitted;
    ledgerEntry.priorApprovedCents =
      ledgerEntry.initialPriorApprovedCents + totalSessionCommitted;
    ledgerEntry.remainingCapCents = Math.max(
      0,
      ledgerEntry.monthlyCapCents - ledgerEntry.priorApprovedCents,
    );

    const jsmInternalNote: JsmInternalNote = {
      noteId: `NOTE-${receipt.claimKey}-${store.jsmInternalNotes.length + 1}`,
      claimKey: receipt.claimKey,
      proposalVersionKey: receipt.proposalVersionKey,
      bodyMarkdown: buildJsmSettlementNoteMarkdown({
        receipt,
        approverId,
        financeOverrideReason,
      }),
      createdAtIso: timestampIso,
      approverId,
    };
    store.jsmInternalNotes.push(jsmInternalNote);

    const propertyKey = `${receipt.claimKey}::clauseclock.settlement`;
    const jiraEntityProperty: JiraEntityPropertyRecord = {
      propertyKey,
      claimKey: receipt.claimKey,
      proposalVersionKey: receipt.proposalVersionKey,
      settlementStatus: 'SETTLED',
      newCreditCents: receipt.mathBreakdown.newCreditCents,
      vendorTotalApportionedCents:
        receipt.mathBreakdown.vendorTotalApportionedCents,
      internalAbsorbedCents: receipt.mathBreakdown.internalAbsorbedCents,
      approverId,
      financeOverrideReason,
      updatedAtIso: timestampIso,
      receipt,
    };
    store.jiraEntityProperties.set(propertyKey, jiraEntityProperty);

    const kvsSettlementRecord: KvsSettlementRecord = {
      kvsKey,
      claimKey: receipt.claimKey,
      scenarioId: receipt.scenarioId,
      customerId: receipt.customerId,
      billingMonth: receipt.billingMonth,
      proposalVersionKey: receipt.proposalVersionKey,
      approverId,
      financeOverrideReason,
      committedAtIso: timestampIso,
      receipt,
    };
    store.kvsSettlementRecords.set(kvsKey, kvsSettlementRecord);

    store.settlementStatusByClaimKey.set(receipt.claimKey, 'SETTLED');

    const realtimeEvent: ForgeRealtimeEvent = {
      channel: 'clause-clock-settlement-sync',
      eventId: `EVT-${receipt.claimKey}-SETTLED-${store.realtimeEvents.length + 1}`,
      claimKey: receipt.claimKey,
      scenarioId: receipt.scenarioId,
      status: 'SETTLED',
      proposalVersionKey: receipt.proposalVersionKey,
      newCreditCents: receipt.mathBreakdown.newCreditCents,
      vendorTotalApportionedCents:
        receipt.mathBreakdown.vendorTotalApportionedCents,
      internalAbsorbedCents: receipt.mathBreakdown.internalAbsorbedCents,
      approverId,
      timestampIso,
    };
    store.realtimeEvents.push(realtimeEvent);

    return {
      status: 200,
      ok: true,
      actionKey,
      message: `Committed credit settlement for ${receipt.claimKey} (${receipt.proposalVersionKey}).`,
      settlementStatus: 'SETTLED',
      idempotentReplay: false,
      currentProposalVersionKey: receipt.proposalVersionKey,
      receipt,
      capLedgerEntry: { ...ledgerEntry },
      jsmInternalNote,
      jiraEntityProperty,
      kvsSettlementRecord,
      realtimeEvent,
      machineReadableFooter: receipt.machineReadableFooter,
    };
  }

  // reset-settlement-state
  const resetAll = payload.resetAll === true;
  const { receipt: targetReceipt, ledgerEntry } = evaluateScenarioAgainstStore(
    store,
    payload,
  );
  const targetClaimKey = targetReceipt.claimKey;

  if (resetAll) {
    store.jsmInternalNotes.length = 0;
    store.jiraEntityProperties.clear();
    store.kvsSettlementRecords.clear();
    for (const [claimKey] of store.settlementStatusByClaimKey) {
      store.settlementStatusByClaimKey.set(claimKey, 'READY');
    }
    for (const entry of store.capLedger.values()) {
      entry.committedByClaimKey = {};
      entry.settledReceipts = {};
      entry.committedInSessionCents = 0;
      entry.priorApprovedCents = entry.initialPriorApprovedCents;
      entry.remainingCapCents = Math.max(
        0,
        entry.monthlyCapCents - entry.initialPriorApprovedCents,
      );
    }
  } else {
    store.settlementStatusByClaimKey.set(targetClaimKey, 'READY');
    delete ledgerEntry.committedByClaimKey[targetClaimKey];
    for (const key of Object.keys(ledgerEntry.settledReceipts)) {
      if (ledgerEntry.settledReceipts[key]?.claimKey === targetClaimKey) {
        delete ledgerEntry.settledReceipts[key];
      }
    }

    let remainingCommitted = 0;
    for (const item of Object.values(ledgerEntry.committedByClaimKey)) {
      remainingCommitted += item.committedCents;
    }
    ledgerEntry.committedInSessionCents = remainingCommitted;
    ledgerEntry.priorApprovedCents =
      ledgerEntry.initialPriorApprovedCents + remainingCommitted;
    ledgerEntry.remainingCapCents = Math.max(
      0,
      ledgerEntry.monthlyCapCents - ledgerEntry.priorApprovedCents,
    );

    for (let i = store.jsmInternalNotes.length - 1; i >= 0; i -= 1) {
      if (store.jsmInternalNotes[i]?.claimKey === targetClaimKey) {
        store.jsmInternalNotes.splice(i, 1);
      }
    }
    store.jiraEntityProperties.delete(`${targetClaimKey}::clauseclock.settlement`);
    for (const kvsKey of [...store.kvsSettlementRecords.keys()]) {
      if (kvsKey.startsWith(`settlement::${targetClaimKey}::`)) {
        store.kvsSettlementRecords.delete(kvsKey);
      }
    }
  }

  const refreshedEval = evaluateScenarioAgainstStore(store, payload);
  const timestampIso = new Date(Date.UTC(2026, 10, 6, 12, 5, 0)).toISOString();
  const realtimeEvent: ForgeRealtimeEvent = {
    channel: 'clause-clock-settlement-sync',
    eventId: `EVT-${targetClaimKey}-READY-${store.realtimeEvents.length + 1}`,
    claimKey: refreshedEval.receipt.claimKey,
    scenarioId: refreshedEval.receipt.scenarioId,
    status: 'READY',
    proposalVersionKey: refreshedEval.receipt.proposalVersionKey,
    newCreditCents: refreshedEval.receipt.mathBreakdown.newCreditCents,
    vendorTotalApportionedCents:
      refreshedEval.receipt.mathBreakdown.vendorTotalApportionedCents,
    internalAbsorbedCents:
      refreshedEval.receipt.mathBreakdown.internalAbsorbedCents,
    approverId: 'SYSTEM-RESET',
    timestampIso,
  };
  store.realtimeEvents.push(realtimeEvent);

  return {
    status: 200,
    ok: true,
    actionKey,
    message: `Reset settlement state for ${refreshedEval.receipt.claimKey} back to READY.`,
    settlementStatus: 'READY',
    currentProposalVersionKey: refreshedEval.receipt.proposalVersionKey,
    receipt: refreshedEval.receipt,
    capLedgerEntry: { ...refreshedEval.ledgerEntry },
    realtimeEvent,
    machineReadableFooter: refreshedEval.receipt.machineReadableFooter,
  };
}
