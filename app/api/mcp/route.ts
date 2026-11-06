import {
  CLAUSE_CLOCK_ACTION_KEYS,
  executeClauseClockAction,
  getDefaultClauseClockStore,
  readSkillMarkdown,
  validateForgeManifestAndSkillContract,
} from '../../../src/actions/index.ts';
import {
  getSeededScenario,
  reconcileClauseClock,
} from '../../../src/core/index.ts';

export interface McpToolDescriptor {
  name: (typeof CLAUSE_CLOCK_ACTION_KEYS)[number];
  actionVerb: 'GET' | 'CREATE' | 'UPDATE';
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export const CLAUSE_CLOCK_MCP_TOOLS: readonly McpToolDescriptor[] = [
  {
    name: 'evaluate-clause-clock',
    actionVerb: 'GET',
    description:
      'Evaluates a JSM SLA claim across overlapping incidents, maintenance exclusions, billing timezones, monthly credit caps, and upstream vendor outage feeds.',
    inputSchema: {
      type: 'object',
      properties: {
        scenarioId: {
          type: 'string',
          description:
            'Seeded scenario ID or JSM claim key (e.g. hero-overlap-splicer or JSM-402).',
        },
        timezoneOverride: {
          type: 'string',
          description: 'Optional IANA timezone override (e.g. UTC or America/Los_Angeles).',
        },
      },
    },
  },
  {
    name: 'run-pbt-audit',
    actionVerb: 'GET',
    description:
      'Runs fast-check Property-Based Testing across P1..P4 invariants against the Uint8Array(44640) minute bitmap oracle.',
    inputSchema: {
      type: 'object',
      properties: {
        numRuns: {
          type: 'number',
          description: 'Number of randomized scenarios to execute (10..500).',
        },
        seed: {
          type: 'number',
          description: 'Deterministic PRNG seed.',
        },
      },
    },
  },
  {
    name: 'commit-credit-settlement',
    actionVerb: 'CREATE',
    description:
      'Commits an approved SLA credit and vendor recovery receipt after validating expectedProposalVersionKey and APPROVAL::<proposalVersionKey>::<approverId>.',
    inputSchema: {
      type: 'object',
      properties: {
        scenarioId: {
          type: 'string',
          description: 'Target scenario ID or JSM claim key.',
        },
        expectedProposalVersionKey: {
          type: 'string',
          description: 'Readable version key from the latest evaluate-clause-clock receipt.',
        },
        approverId: {
          type: 'string',
          description: 'Human approver identifier.',
        },
        approvalToken: {
          type: 'string',
          description: 'Human confirmation token: APPROVAL::<proposalVersionKey>::<approverId>.',
        },
        financeOverrideReason: {
          type: 'string',
          description: 'Required when committing a contract in DRAFT status.',
        },
      },
      required: ['expectedProposalVersionKey', 'approverId', 'approvalToken'],
    },
  },
  {
    name: 'reset-settlement-state',
    actionVerb: 'UPDATE',
    description:
      'Restores a settled claim and its monthly cap ledger balance back to the pre-settlement READY state.',
    inputSchema: {
      type: 'object',
      properties: {
        scenarioId: {
          type: 'string',
          description: 'Scenario ID or JSM claim key to reset.',
        },
        resetAll: {
          type: 'boolean',
          description: 'When true, resets all claims in the store.',
        },
      },
    },
  },
];

export async function GET(_request?: Request): Promise<Response> {
  const skillMarkdown = readSkillMarkdown();
  const contractValidation = validateForgeManifestAndSkillContract({
    skillMarkdown,
  });

  return Response.json(
    {
      ok: true,
      serverName: 'clause-clock-mcp-server',
      skillName: 'clause-clock',
      tools: CLAUSE_CLOCK_MCP_TOOLS,
      skillMarkdown,
      contractValidation,
    },
    { status: 200 },
  );
}

export async function POST(request: Request): Promise<Response> {
  const store = getDefaultClauseClockStore();
  const defaultFooter = reconcileClauseClock(
    getSeededScenario(),
  ).machineReadableFooter;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        ok: false,
        status: 400,
        errorCode: 'MALFORMED_ACTION_PAYLOAD',
        message: 'Invalid JSON in MCP request body.',
        machineReadableFooter: defaultFooter,
      },
      { status: 400 },
    );
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json(
      {
        ok: false,
        status: 400,
        errorCode: 'MALFORMED_ACTION_PAYLOAD',
        message: 'MCP request body must be a JSON object.',
        machineReadableFooter: defaultFooter,
      },
      { status: 400 },
    );
  }

  const record = body as Record<string, unknown>;
  const method = typeof record.method === 'string' ? record.method : 'tools/call';

  if (method === 'tools/list') {
    return Response.json(
      {
        ok: true,
        method: 'tools/list',
        tools: CLAUSE_CLOCK_MCP_TOOLS,
      },
      { status: 200 },
    );
  }

  if (method === 'skills/read') {
    const skillMarkdown = readSkillMarkdown();
    return Response.json(
      {
        ok: true,
        method: 'skills/read',
        skillName: 'clause-clock',
        allowedTools: [...CLAUSE_CLOCK_ACTION_KEYS],
        skillMarkdown,
      },
      { status: 200 },
    );
  }

  if (method === 'tools/call') {
    const params =
      typeof record.params === 'object' &&
      record.params !== null &&
      !Array.isArray(record.params)
        ? (record.params as Record<string, unknown>)
        : record;

    const toolName = params.name ?? record.toolName ?? record.actionKey;
    const toolArguments =
      'arguments' in params
        ? params.arguments
        : 'payload' in record
          ? record.payload
          : {};

    const result = executeClauseClockAction(store, toolName, toolArguments);
    return Response.json(
      {
        ok: result.ok,
        method: 'tools/call',
        toolName: String(toolName ?? ''),
        result,
        content: [
          {
            type: 'text',
            text: `${result.message}\n${result.machineReadableFooter}`,
          },
        ],
      },
      { status: result.status },
    );
  }

  return Response.json(
    {
      ok: false,
      status: 400,
      errorCode: 'UNKNOWN_ACTION_KEY',
      message: `Unsupported MCP method "${method}". Supported methods: tools/list, tools/call, skills/read.`,
      machineReadableFooter: defaultFooter,
    },
    { status: 400 },
  );
}
