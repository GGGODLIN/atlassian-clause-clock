'use client';

import { useId, useReducer } from 'react';
import { CLAUSE_CLOCK_ACTION_KEYS } from '../../src/actions/clause-clock-store.ts';
import {
  isRecord,
  type ClauseClockHostPort,
  type McpToolExchange,
  type McpToolSummary,
  type SkillContractSnapshot,
} from './host-port.ts';
import { runMcpToolCommand, type WorkbenchAction } from './workbench-controller.ts';

const EXCHANGE_HISTORY_LIMIT = 4;

export interface McpExchangeReceiptProps {
  exchange: McpToolExchange;
}

export function McpExchangeReceipt({ exchange }: McpExchangeReceiptProps) {
  const ok = exchange.result?.ok === true;
  return (
    <article
      data-testid="mcp-exchange-receipt"
      data-status={exchange.httpStatus}
      className="rounded-2xl border border-case-rule bg-case/80 p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
        <span className="text-case-text">
          tools/call · <span className="text-brass">{exchange.request.params.name}</span>
        </span>
        <span
          className={`rounded-full px-2 py-0.5 font-semibold ${ok ? 'bg-lume text-ink' : 'bg-signal text-paper'}`}
        >
          HTTP {exchange.httpStatus}
          {exchange.result?.errorCode ? ` · ${exchange.result.errorCode}` : ''}
        </span>
      </header>
      <div className="mt-3 grid gap-3 @4xl:grid-cols-2">
        <figure className="min-w-0">
          <figcaption className="cc-eyebrow mb-1 text-[9px] text-case-muted">Request</figcaption>
          <pre
            data-testid="mcp-request-json"
            className="cc-scroll max-h-64 overflow-auto whitespace-pre-wrap wrap-anywhere rounded-lg bg-case-3/70 p-3 font-mono text-[11px] leading-relaxed text-case-text"
          >
            {JSON.stringify(exchange.request, null, 2)}
          </pre>
        </figure>
        <figure className="min-w-0">
          <figcaption className="cc-eyebrow mb-1 text-[9px] text-case-muted">Response</figcaption>
          <pre
            data-testid="mcp-response-json"
            className="cc-scroll max-h-64 overflow-auto whitespace-pre-wrap wrap-anywhere rounded-lg bg-case-3/70 p-3 font-mono text-[11px] leading-relaxed text-case-text"
          >
            {JSON.stringify(exchange.response, null, 2)}
          </pre>
        </figure>
      </div>
      <p
        data-testid="mcp-footer"
        className="mt-3 break-all rounded-lg border border-lume/30 px-3 py-2 font-mono text-[11px] text-lume"
      >
        {exchange.machineReadableFooter}
      </p>
    </article>
  );
}

interface SkillLine {
  id: string;
  text: string;
  kind: 'frontmatter' | 'heading' | 'body';
}

function toSkillLines(markdown: string): SkillLine[] {
  let fenceCount = 0;
  return markdown.split('\n').map((text, offset) => {
    const isFence = text.trim() === '---';
    if (isFence) {
      fenceCount += 1;
    }
    const inFrontmatter = isFence || fenceCount === 1;
    return {
      id: `L${offset + 1}`,
      text,
      kind: inFrontmatter && fenceCount <= 2 ? 'frontmatter' : text.startsWith('#') ? 'heading' : 'body',
    };
  });
}

const LINE_CLASSES: Record<SkillLine['kind'], string> = {
  frontmatter: 'text-brass',
  heading: 'text-case-text font-semibold',
  body: 'text-case-muted',
};

interface RecordedExchange {
  sequence: number;
  exchange: McpToolExchange;
}

interface InspectorState {
  skill: SkillContractSnapshot | null;
  skillError: string | null;
  activeTool: string;
  drafts: Readonly<Record<string, string>>;
  argumentError: string | null;
  runningTool: string | null;
  exchanges: readonly RecordedExchange[];
}

type InspectorAction =
  | { type: 'SKILL_LOADED'; skill: SkillContractSnapshot }
  | { type: 'SKILL_FAILED'; message: string }
  | { type: 'SELECT_TOOL'; tool: string }
  | { type: 'EDIT_ARGUMENTS'; tool: string; text: string }
  | { type: 'RESET_ARGUMENTS'; tool: string }
  | { type: 'ARGUMENTS_INVALID'; message: string }
  | { type: 'RUN_STARTED'; tool: string }
  | { type: 'RUN_FINISHED'; exchange: McpToolExchange }
  | { type: 'RUN_FAILED'; message: string };

function inspectorReducer(state: InspectorState, action: InspectorAction): InspectorState {
  switch (action.type) {
    case 'SKILL_LOADED':
      return { ...state, skill: action.skill, skillError: null };
    case 'SKILL_FAILED':
      return { ...state, skillError: action.message };
    case 'SELECT_TOOL':
      return { ...state, activeTool: action.tool, argumentError: null };
    case 'EDIT_ARGUMENTS':
      return { ...state, drafts: { ...state.drafts, [action.tool]: action.text }, argumentError: null };
    case 'RESET_ARGUMENTS': {
      const { [action.tool]: _discarded, ...remaining } = state.drafts;
      return { ...state, drafts: remaining, argumentError: null };
    }
    case 'ARGUMENTS_INVALID':
      return { ...state, argumentError: action.message };
    case 'RUN_STARTED':
      return { ...state, activeTool: action.tool, runningTool: action.tool, argumentError: null };
    case 'RUN_FINISHED':
      return {
        ...state,
        runningTool: null,
        exchanges: [
          { sequence: (state.exchanges[0]?.sequence ?? 0) + 1, exchange: action.exchange },
          ...state.exchanges,
        ].slice(0, EXCHANGE_HISTORY_LIMIT),
      };
    case 'RUN_FAILED':
      return { ...state, runningTool: null, argumentError: action.message };
  }
}

function parseArguments(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const FALLBACK_TOOLS: readonly McpToolSummary[] = CLAUSE_CLOCK_ACTION_KEYS.map((name) => ({
  name,
  actionVerb: '—',
  description: 'Load the live SKILL.md contract to read this tool descriptor.',
}));

export interface McpInspectorProps {
  hostPort: ClauseClockHostPort;
  initialSkillContract: SkillContractSnapshot | null;
  defaultArguments: Readonly<Record<string, Record<string, unknown>>>;
  onWorkbenchAction: (action: WorkbenchAction) => void;
}

export function McpInspector({ hostPort, initialSkillContract, defaultArguments, onWorkbenchAction }: McpInspectorProps) {
  const argumentsFieldId = useId();
  const [state, dispatch] = useReducer(inspectorReducer, {
    skill: initialSkillContract,
    skillError: null,
    activeTool: CLAUSE_CLOCK_ACTION_KEYS[0],
    drafts: {},
    argumentError: null,
    runningTool: null,
    exchanges: [],
  });
  const tools = state.skill?.tools ?? FALLBACK_TOOLS;
  const argumentsText = (tool: string): string =>
    state.drafts[tool] ?? JSON.stringify(defaultArguments[tool] ?? {}, null, 2);

  const reloadSkill = async () => {
    try {
      dispatch({ type: 'SKILL_LOADED', skill: await hostPort.readSkillContract() });
    } catch (error: unknown) {
      dispatch({ type: 'SKILL_FAILED', message: error instanceof Error ? error.message : 'SKILL.md read failed.' });
    }
  };

  const runTool = async (tool: string) => {
    const args = parseArguments(argumentsText(tool));
    if (!args) {
      dispatch({ type: 'SELECT_TOOL', tool });
      dispatch({ type: 'ARGUMENTS_INVALID', message: `Arguments for ${tool} must be a JSON object.` });
      return;
    }
    dispatch({ type: 'RUN_STARTED', tool });
    const action = await runMcpToolCommand(hostPort, tool, args);
    onWorkbenchAction(action);
    if (action.type === 'MCP_TOOL_EXECUTED') {
      dispatch({ type: 'RUN_FINISHED', exchange: action.exchange });
    } else if (action.type === 'HOST_FAILED') {
      dispatch({ type: 'RUN_FAILED', message: action.message });
    }
  };

  const skillLines = state.skill ? toSkillLines(state.skill.skillMarkdown) : [];

  return (
    <section
      data-testid="mcp-inspector"
      aria-labelledby="cc-mcp-heading"
      className="cc-case cc-rise rounded-[2rem] p-5 @3xl:p-7"
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="cc-eyebrow text-brass">rovo:mcp · rovo:skill · 4 deterministic actions</p>
          <h2 id="cc-mcp-heading" className="mt-1 font-display text-3xl leading-none text-case-text @3xl:text-4xl">
            Rovo MCP &amp; SKILL.md Live Inspector
          </h2>
        </div>
        <p className="font-mono text-[11px] text-case-muted">transport · {hostPort.hostLabel}</p>
      </header>

      <div className="mt-6 grid gap-5 @5xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[11px] text-case-text">skills/clause-clock/SKILL.md</p>
            <span
              data-testid="skill-contract-status"
              data-valid={state.skill?.contractValid ?? false}
              className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold ${
                state.skill?.contractValid ? 'bg-lume text-ink' : 'bg-signal text-paper'
              }`}
            >
              {state.skill
                ? state.skill.contractValid
                  ? 'contract aligned · manifest.yml + SKILL.md + 4 actions'
                  : `${state.skill.contractErrors.length} contract error(s)`
                : 'not loaded'}
            </span>
          </div>
          {state.skill ? (
            <pre
              data-testid="skill-md-viewer"
              className="cc-scroll max-h-[28rem] overflow-auto rounded-2xl border border-case-rule bg-case/80 p-4 font-mono text-[11px] leading-relaxed [counter-reset:skill-line]"
            >
              {skillLines.map((line) => (
                <span
                  key={line.id}
                  className={`block whitespace-pre-wrap pl-10 -indent-10 before:inline-block before:w-10 before:pr-3 before:text-right before:text-case-rule before:content-[counter(skill-line)] [counter-increment:skill-line] ${LINE_CLASSES[line.kind]}`}
                >
                  {line.text.length > 0 ? line.text : ' '}
                </span>
              ))}
            </pre>
          ) : (
            <p className="rounded-2xl border border-dashed border-case-rule p-4 font-mono text-xs text-case-muted">
              The host has not handed over SKILL.md yet.
            </p>
          )}
          {state.skillError ? <p role="alert" className="font-mono text-xs text-signal">{state.skillError}</p> : null}
          <button
            type="button"
            onClick={reloadSkill}
            className="self-start rounded-full border border-case-rule px-4 py-1.5 font-mono text-[11px] text-case-text transition hover:border-lume hover:text-lume"
          >
            Re-read live SKILL.md · GET /api/mcp
          </button>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <ul className="grid gap-2 @xl:grid-cols-2">
            {tools.map((tool) => {
              const active = tool.name === state.activeTool;
              return (
                <li
                  key={tool.name}
                  data-testid="mcp-tool"
                  data-tool-name={tool.name}
                  className={`flex flex-col gap-2 rounded-xl border p-3 transition-colors ${
                    active ? 'border-lume/60 bg-lume/5' : 'border-case-rule bg-case-2/60'
                  }`}
                >
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => dispatch({ type: 'SELECT_TOOL', tool: tool.name })}
                    className="flex items-center justify-between gap-2 text-left"
                  >
                    <span className="font-mono text-xs font-semibold text-case-text">{tool.name}</span>
                    <span className="rounded border border-case-rule px-1.5 font-mono text-[10px] text-brass">
                      {tool.actionVerb}
                    </span>
                  </button>
                  <p className="text-[11px] leading-snug text-case-muted">{tool.description}</p>
                  <button
                    type="button"
                    data-testid="mcp-tool-run"
                    disabled={state.runningTool !== null}
                    onClick={() => runTool(tool.name)}
                    className="self-start rounded-full bg-case-text px-3 py-1 font-mono text-[11px] font-semibold text-ink transition hover:bg-lume disabled:cursor-wait disabled:opacity-50"
                  >
                    {state.runningTool === tool.name ? 'calling…' : 'Run tools/call'}
                  </button>
                </li>
              );
            })}
          </ul>

          <div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={argumentsFieldId} className="font-mono text-[11px] text-case-text">
                arguments · <span className="text-brass">{state.activeTool}</span>
              </label>
              <button
                type="button"
                onClick={() => dispatch({ type: 'RESET_ARGUMENTS', tool: state.activeTool })}
                className="font-mono text-[10px] text-case-muted underline-offset-2 hover:text-case-text hover:underline"
              >
                reset to current claim
              </button>
            </div>
            <textarea
              id={argumentsFieldId}
              spellCheck={false}
              value={argumentsText(state.activeTool)}
              onChange={(event) =>
                dispatch({ type: 'EDIT_ARGUMENTS', tool: state.activeTool, text: event.target.value })
              }
              rows={7}
              className="cc-scroll mt-1 w-full rounded-xl border border-case-rule bg-case/80 p-3 font-mono text-[11px] leading-relaxed text-case-text focus:border-lume"
            />
            {state.activeTool === 'commit-credit-settlement' ? (
              <p className="mt-1 font-mono text-[10px] text-case-muted">
                approvalToken starts empty so you can watch the gate answer 400. The token APPROVAL::&lt;key&gt;::&lt;approverId&gt;
                only records which proposal key a named approver accepted; it is a readable binding, not a secret or a
                signature.
              </p>
            ) : null}
            {state.argumentError ? (
              <p role="alert" className="mt-1 font-mono text-xs text-signal">
                {state.argumentError}
              </p>
            ) : null}
          </div>

          <div aria-live="polite" className="flex flex-col gap-3">
            {state.exchanges.map((recorded) => (
              <McpExchangeReceipt key={recorded.sequence} exchange={recorded.exchange} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
