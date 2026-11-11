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

import { CLAUSE_CLOCK_MCP_TOOLS } from '../../../src/mcp-tools.ts';

export async function GET(_request: Request): Promise<Response> {
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

const SKILL_RESOURCE_URI = 'clause-clock://skills/clause-clock';

function handleJsonRpc(record: Record<string, unknown>): Response {
  const id = typeof record.id === 'string' || typeof record.id === 'number' ? record.id : null;
  const error = (code: number, message: string): Response => Response.json({ jsonrpc: '2.0', id, error: { code, message } });
  if (record.jsonrpc !== '2.0' || typeof record.method !== 'string' || ('id' in record && id === null)) {
    return error(-32600, 'Invalid JSON-RPC request');
  }
  if (!('id' in record)) return new Response(null, { status: 202 });
  const params = typeof record.params === 'object' && record.params !== null && !Array.isArray(record.params)
    ? record.params as Record<string, unknown> : undefined;
  const respond = (result: unknown): Response => Response.json({ jsonrpc: '2.0', id, result });
  switch (record.method) {
    case 'initialize': {
      if (!params || typeof params.protocolVersion !== 'string' || !params.clientInfo || !params.capabilities) return error(-32602, 'Invalid initialize params');
      const supported = ['2025-03-26', '2025-06-18', '2025-11-25'];
      return respond({
        protocolVersion: supported.includes(params.protocolVersion) ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'clause-clock-mcp-server', version: '0.1.0' },
      });
    }
    case 'ping': return respond({});
    case 'tools/list': return respond({ tools: CLAUSE_CLOCK_MCP_TOOLS });
    case 'resources/list': return respond({ resources: [{ uri: SKILL_RESOURCE_URI, name: 'clause-clock', description: 'Portable ClauseClock skill contract', mimeType: 'text/markdown' }] });
    case 'resources/read':
      if (!params || typeof params.uri !== 'string') return error(-32602, 'Resource uri is required');
      if (params.uri !== SKILL_RESOURCE_URI) return error(-32002, 'Resource not found');
      return respond({ contents: [{ uri: SKILL_RESOURCE_URI, mimeType: 'text/markdown', text: readSkillMarkdown() }] });
    case 'tools/call': {
      if (!params || typeof params.name !== 'string' || (params.arguments !== undefined && (typeof params.arguments !== 'object' || params.arguments === null || Array.isArray(params.arguments)))) return error(-32602, 'Invalid tool params');
      if (!(CLAUSE_CLOCK_ACTION_KEYS as readonly string[]).includes(params.name)) return error(-32602, 'Unknown tool');
      const tool = CLAUSE_CLOCK_MCP_TOOLS.find(tool => tool.name === params.name);
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      for (const required of tool?.inputSchema.required ?? []) {
        if (!(required in args)) return error(-32602, `Missing tool argument: ${required}`);
      }
      for (const [key, value] of Object.entries(args)) {
        const type = tool?.inputSchema.properties[key]?.type;
        if (type && typeof value !== type) return error(-32602, `Invalid tool argument: ${key}`);
      }
      const result = executeClauseClockAction(getDefaultClauseClockStore(), params.name, args);
      return respond({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: !result.ok });
    }
    default: return error(-32601, 'Method not found');
  }
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
        jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' },
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
        jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' },
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
  if ('jsonrpc' in record) return handleJsonRpc(record);
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
