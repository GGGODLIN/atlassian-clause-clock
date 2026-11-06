import type { ClauseClockActionResult } from '../../src/actions/clause-clock-dispatcher.ts';
import type {
  ClauseClockActionKey,
  ForgeRealtimeEvent,
} from '../../src/actions/clause-clock-store.ts';
import type { CalculationReceipt } from '../../src/core/clause-clock-types.ts';

export const CLAUSE_CLOCK_SETTLEMENT_CHANNEL = 'clause-clock-settlement-sync';

export interface McpToolSummary {
  name: string;
  actionVerb: string;
  description: string;
}

export interface SkillContractSnapshot {
  skillName: string;
  skillMarkdown: string;
  tools: readonly McpToolSummary[];
  contractValid: boolean;
  contractErrors: readonly string[];
}

export interface McpToolCallRequest {
  method: 'tools/call';
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface McpToolExchange {
  request: McpToolCallRequest;
  httpStatus: number;
  response: unknown;
  result: ClauseClockActionResult | null;
  machineReadableFooter: string;
}

export interface SettlementBroadcast {
  channel: typeof CLAUSE_CLOCK_SETTLEMENT_CHANNEL;
  event: ForgeRealtimeEvent;
  receipt: CalculationReceipt | null;
}

export type SettlementListener = (message: SettlementBroadcast) => void;

export interface ClauseClockHostPort {
  readonly hostLabel: string;
  executeAction(
    actionKey: ClauseClockActionKey,
    payload: Record<string, unknown>,
  ): Promise<ClauseClockActionResult>;
  callMcpTool(toolName: string, args: Record<string, unknown>): Promise<McpToolExchange>;
  readSkillContract(): Promise<SkillContractSnapshot>;
  subscribeSettlementChannel(listener: SettlementListener): () => void;
  copyText(text: string): Promise<void>;
}

export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

export interface HttpHostPortOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  clipboard?: ClipboardWriter;
  hostLabel?: string;
}

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toActionResult(body: unknown): ClauseClockActionResult {
  if (!isRecord(body) || typeof body.ok !== 'boolean' || typeof body.status !== 'number') {
    throw new Error('ClauseClock host returned a response without an action result envelope.');
  }
  const { realtimeEvents: _realtimeLog, ...result } = body;
  return result as unknown as ClauseClockActionResult;
}

export function parseSkillContractSnapshot(body: unknown): SkillContractSnapshot {
  if (!isRecord(body) || typeof body.skillMarkdown !== 'string' || !Array.isArray(body.tools)) {
    throw new Error('ClauseClock MCP server returned an unreadable SKILL.md contract.');
  }
  const validation = isRecord(body.contractValidation) ? body.contractValidation : {};
  return {
    skillName: typeof body.skillName === 'string' ? body.skillName : '',
    skillMarkdown: body.skillMarkdown,
    tools: body.tools.filter(isRecord).map((tool) => ({
      name: String(tool.name ?? ''),
      actionVerb: String(tool.actionVerb ?? ''),
      description: String(tool.description ?? ''),
    })),
    contractValid: validation.valid === true,
    contractErrors: Array.isArray(validation.errors) ? validation.errors.map(String) : [],
  };
}

// An idempotent replay carries no realtimeEvent because the store already held the settlement; re-announcing it from the
// stored record keeps a subscriber that missed the original commit (another tab, an MCP client) from staying READY.
function replayedSettlementEvent(result: ClauseClockActionResult): ForgeRealtimeEvent | null {
  const record = result.kvsSettlementRecord;
  const receipt = result.receipt;
  if (!result.idempotentReplay || !record || !receipt) {
    return null;
  }
  return {
    channel: CLAUSE_CLOCK_SETTLEMENT_CHANNEL,
    eventId: `EVT-${record.claimKey}-SETTLED-REPLAY`,
    claimKey: record.claimKey,
    scenarioId: record.scenarioId,
    status: 'SETTLED',
    proposalVersionKey: record.proposalVersionKey,
    newCreditCents: receipt.mathBreakdown.newCreditCents,
    vendorTotalApportionedCents: receipt.mathBreakdown.vendorTotalApportionedCents,
    internalAbsorbedCents: receipt.mathBreakdown.internalAbsorbedCents,
    approverId: record.approverId,
    timestampIso: record.committedAtIso,
  };
}

// The web studio has no server push, so this adapter re-emits the realtimeEvent each mutating response carries,
// standing in for the @forge/realtime subscription a Forge Custom UI host would wire here.
export function createHttpClauseClockHostPort(options: HttpHostPortOptions = {}): ClauseClockHostPort {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const baseUrl = options.baseUrl ?? '';
  const listeners = new Set<SettlementListener>();

  const publish = (result: ClauseClockActionResult | null): void => {
    const event = result?.ok ? (result.realtimeEvent ?? replayedSettlementEvent(result)) : null;
    if (!result || !event) {
      return;
    }
    const message: SettlementBroadcast = {
      channel: CLAUSE_CLOCK_SETTLEMENT_CHANNEL,
      event,
      receipt: result.receipt ?? null,
    };
    for (const listener of [...listeners]) {
      listener(message);
    }
  };

  const requestJson = async (path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> => {
    const response = await fetchImpl(`${baseUrl}${path}`, init);
    const body: unknown = await response.json();
    return { status: response.status, body };
  };

  return {
    hostLabel: options.hostLabel ?? 'Next.js Web Studio · /api/clause-clock + /api/mcp',

    async executeAction(actionKey, payload) {
      const { body } = await requestJson('/api/clause-clock', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ actionKey, payload }),
      });
      const result = toActionResult(body);
      publish(result);
      return result;
    },

    async callMcpTool(toolName, args) {
      const request: McpToolCallRequest = {
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      };
      const { status, body } = await requestJson('/api/mcp', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(request),
      });
      const result =
        isRecord(body) && isRecord(body.result)
          ? (body.result as unknown as ClauseClockActionResult)
          : null;
      publish(result);
      const envelopeFooter =
        isRecord(body) && typeof body.machineReadableFooter === 'string' ? body.machineReadableFooter : '';
      return {
        request,
        httpStatus: status,
        response: body,
        result,
        machineReadableFooter: result?.machineReadableFooter ?? envelopeFooter,
      };
    },

    async readSkillContract() {
      const { body } = await requestJson('/api/mcp');
      return parseSkillContractSnapshot(body);
    },

    subscribeSettlementChannel(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async copyText(text) {
      const clipboard = options.clipboard ?? globalThis.navigator?.clipboard;
      if (!clipboard) {
        throw new Error('Clipboard access is unavailable in this host; copy the Markdown from the preview instead.');
      }
      await clipboard.writeText(text);
    },
  };
}
