import Resolver from '@forge/resolver';
import { createForgeRuntimePort } from './forge/forge-sdk.ts';
import { executeForgeAction } from './forge/forge-runtime.ts';
import { CLAUSE_CLOCK_ACTION_KEYS } from './actions/clause-clock-store.ts';
import { CLAUSE_CLOCK_MCP_TOOLS } from './mcp-tools.ts';
import skillMarkdown from './forge/skill-markdown.ts';

interface Invocation {
  call?: { functionKey?: string };
  payload?: Record<string, unknown>;
  context?: { cloudId?: string; moduleKey?: string; extension?: { issue?: { key?: string } }; jira?: { issueKey?: string } };
  [key: string]: unknown;
}

const resolver = new Resolver();
resolver.define('skill-contract', () => ({
  skillName: 'clause-clock', skillMarkdown, tools: CLAUSE_CLOCK_MCP_TOOLS,
  contractValidation: { valid: true, errors: [] },
}));
for (const actionKey of CLAUSE_CLOCK_ACTION_KEYS) {
  resolver.define(actionKey, async ({ payload, context }) => {
    if (!context.cloudId) throw new Error('Forge cloud context is required');
    return executeForgeAction(createForgeRuntimePort(context.cloudId), actionKey, payload, context.extension?.issue?.key);
  });
}
const invokeResolver = resolver.getDefinitions();

export async function routeClauseClockForgeAction(event: Invocation, context?: Invocation['context']): Promise<unknown> {
  if (event.call) return invokeResolver(event as Parameters<typeof invokeResolver>[0]);
  const invocationContext = event.context ?? context;
  const actionKey = invocationContext?.moduleKey;
  if (!invocationContext?.cloudId || !actionKey || !(CLAUSE_CLOCK_ACTION_KEYS as readonly string[]).includes(actionKey)) {
    throw new Error('A trusted Forge action context is required');
  }
  return executeForgeAction(createForgeRuntimePort(invocationContext.cloudId), actionKey, event, invocationContext.jira?.issueKey);
}
