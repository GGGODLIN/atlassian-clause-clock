import { CLAUSE_CLOCK_ACTION_KEYS } from './actions/clause-clock-store.ts';

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

