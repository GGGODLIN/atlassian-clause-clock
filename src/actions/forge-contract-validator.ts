import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUSE_CLOCK_ACTION_KEYS } from './clause-clock-store.ts';

export interface ForgeContractValidationReport {
  valid: boolean;
  errors: string[];
  hasGraphConnector: boolean;
  singleFunctionHandlerKey: string | null;
  declaredModules: string[];
  manifestActionKeys: string[];
  skillName: string | null;
  skillAllowedTools: string[];
  actionVerbsByKey: Record<string, string>;
}

const REQUIRED_MODULES = [
  'jira:issuePanel',
  'jira:globalPage',
  'rovo:agent',
  'rovo:skill',
  'rovo:mcp',
  'action',
  'function',
] as const;

const EXPECTED_ACTION_VERBS: Record<string, string> = {
  'evaluate-clause-clock': 'GET',
  'run-pbt-audit': 'GET',
  'commit-credit-settlement': 'CREATE',
  'reset-settlement-state': 'UPDATE',
};

function resolveProjectRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), '..', '..');
}

export function readSkillMarkdown(customRoot?: string): string {
  const rootDir = customRoot ?? resolveProjectRoot();
  const skillPath = path.join(rootDir, 'skills', 'clause-clock', 'SKILL.md');
  return fs.readFileSync(skillPath, 'utf8');
}

export function readForgeManifestYaml(customRoot?: string): string {
  const rootDir = customRoot ?? resolveProjectRoot();
  const manifestPath = path.join(rootDir, 'manifest.yml');
  return fs.readFileSync(manifestPath, 'utf8');
}

function parseSkillFrontmatter(skillMarkdown: string): {
  skillName: string | null;
  allowedTools: string[];
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMarkdown);
  if (!match || !match[1]) {
    return { skillName: null, allowedTools: [] };
  }
  const frontmatter = match[1];
  const nameMatch = /^name:\s*(.+)$/m.exec(frontmatter);
  const skillName = nameMatch?.[1]?.trim() ?? null;

  const allowedTools: string[] = [];
  const lines = frontmatter.split(/\r?\n/);
  let inAllowedTools = false;
  for (const line of lines) {
    if (/^allowed-tools:\s*$/.test(line)) {
      inAllowedTools = true;
      continue;
    }
    if (inAllowedTools) {
      const itemMatch = /^\s*-\s+([a-z0-9-]+)\s*$/.exec(line);
      if (itemMatch?.[1]) {
        allowedTools.push(itemMatch[1]);
      } else if (/^[a-zA-Z0-9_-]+:/.test(line)) {
        inAllowedTools = false;
      }
    }
  }

  return { skillName, allowedTools };
}

function parseManifestContract(manifestYaml: string): {
  hasGraphConnector: boolean;
  declaredModules: string[];
  functionKeys: string[];
  manifestActionKeys: string[];
  actionFunctionRefs: string[];
  actionVerbsByKey: Record<string, string>;
} {
  const hasGraphConnector = /(?:^|\s)graph:connector\s*:/m.test(manifestYaml);
  const declaredModules: string[] = [];
  for (const mod of REQUIRED_MODULES) {
    const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`^\\s{2}${escaped}:\\s*$`, 'm').test(manifestYaml)) {
      declaredModules.push(mod);
    }
  }

  const lines = manifestYaml.split(/\r?\n/);
  let currentSection: string | null = null;
  let currentActionKey: string | null = null;
  const functionKeys: string[] = [];
  const manifestActionKeys: string[] = [];
  const actionFunctionRefs: string[] = [];
  const actionVerbsByKey: Record<string, string> = {};

  for (const line of lines) {
    const sectionMatch = /^  ([a-zA-Z]+(?::[a-zA-Z]+)?):\s*$/.exec(line);
    if (sectionMatch?.[1]) {
      currentSection = sectionMatch[1];
      currentActionKey = null;
      continue;
    }
    if (/^[a-zA-Z]+:\s*$/.test(line) && !line.startsWith('  ')) {
      currentSection = null;
      currentActionKey = null;
      continue;
    }

    if (currentSection === 'function') {
      const fnKeyMatch = /^\s{4}-\s+key:\s+([a-z0-9-]+)\s*$/.exec(line);
      if (fnKeyMatch?.[1]) {
        functionKeys.push(fnKeyMatch[1]);
      }
    }

    if (currentSection === 'action') {
      const actionKeyMatch = /^\s{4}-\s+key:\s+([a-z0-9-]+)\s*$/.exec(line);
      if (actionKeyMatch?.[1]) {
        currentActionKey = actionKeyMatch[1];
        manifestActionKeys.push(currentActionKey);
        continue;
      }
      if (currentActionKey) {
        const fnRefMatch = /^\s{6}function:\s+([a-z0-9-]+)\s*$/.exec(line);
        if (fnRefMatch?.[1]) {
          actionFunctionRefs.push(fnRefMatch[1]);
        }
        const verbMatch = /^\s{6}actionVerb:\s+([A-Z]+)\s*$/.exec(line);
        if (verbMatch?.[1]) {
          actionVerbsByKey[currentActionKey] = verbMatch[1];
        }
      }
    }
  }

  return {
    hasGraphConnector,
    declaredModules,
    functionKeys,
    manifestActionKeys,
    actionFunctionRefs,
    actionVerbsByKey,
  };
}

export function validateForgeManifestAndSkillContract(options?: {
  manifestYaml?: string;
  skillMarkdown?: string;
}): ForgeContractValidationReport {
  const manifestYaml = options?.manifestYaml ?? readForgeManifestYaml();
  const skillMarkdown = options?.skillMarkdown ?? readSkillMarkdown();
  const errors: string[] = [];

  const {
    hasGraphConnector,
    declaredModules,
    functionKeys,
    manifestActionKeys,
    actionFunctionRefs,
    actionVerbsByKey,
  } = parseManifestContract(manifestYaml);

  if (hasGraphConnector) {
    errors.push(
      'manifest.yml must not declare graph:connector when using requestTeamworkGraph.',
    );
  }

  for (const requiredMod of REQUIRED_MODULES) {
    if (!declaredModules.includes(requiredMod)) {
      errors.push(`manifest.yml is missing required module "${requiredMod}".`);
    }
  }

  const singleFunctionHandlerKey =
    functionKeys.length === 1 ? (functionKeys[0] ?? null) : null;
  if (functionKeys.length !== 1) {
    errors.push(
      `Expected exactly 1 Forge function router in manifest.yml, found ${functionKeys.length}.`,
    );
  }

  const expectedActions = [...CLAUSE_CLOCK_ACTION_KEYS];
  if (
    manifestActionKeys.length !== expectedActions.length ||
    !expectedActions.every((key, idx) => manifestActionKeys[idx] === key)
  ) {
    errors.push(
      `manifest.yml action keys [${manifestActionKeys.join(', ')}] do not match CLAUSE_CLOCK_ACTION_KEYS [${expectedActions.join(', ')}].`,
    );
  }

  if (
    singleFunctionHandlerKey &&
    (actionFunctionRefs.length !== expectedActions.length ||
      !actionFunctionRefs.every((ref) => ref === singleFunctionHandlerKey))
  ) {
    errors.push(
      `All 4 manifest.yml actions must route to the single function handler "${singleFunctionHandlerKey}".`,
    );
  }

  for (const [actionKey, expectedVerb] of Object.entries(EXPECTED_ACTION_VERBS)) {
    if (actionVerbsByKey[actionKey] !== expectedVerb) {
      errors.push(
        `Action "${actionKey}" expected actionVerb "${expectedVerb}", found "${actionVerbsByKey[actionKey] ?? 'missing'}".`,
      );
    }
  }

  const { skillName, allowedTools } = parseSkillFrontmatter(skillMarkdown);
  if (skillName !== 'clause-clock') {
    errors.push(
      `skills/clause-clock/SKILL.md frontmatter name must be "clause-clock", found "${String(skillName)}".`,
    );
  }

  if (
    allowedTools.length !== expectedActions.length ||
    !expectedActions.every((key, idx) => allowedTools[idx] === key)
  ) {
    errors.push(
      `skills/clause-clock/SKILL.md allowed-tools [${allowedTools.join(', ')}] do not match CLAUSE_CLOCK_ACTION_KEYS [${expectedActions.join(', ')}].`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    hasGraphConnector,
    singleFunctionHandlerKey,
    declaredModules,
    manifestActionKeys,
    skillName,
    skillAllowedTools: allowedTools,
    actionVerbsByKey,
  };
}
