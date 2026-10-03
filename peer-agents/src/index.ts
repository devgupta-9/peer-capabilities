import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { effortSchema, parseCodexCatalog, validateChoice, type ModelChoice } from './model-policy.js';
import { authorizeWorkingDirectory } from './path-policy.js';
import { runCapture, truncate } from './process.js';
import { finalizeImplementationWorktree, type ImplementationPatch } from './worktree.js';
import { childEnvironment, redact } from './security.js';

type AgentName = 'codex' | 'antigravity';
type Mode = 'READ_ONLY' | 'REVIEW' | 'IMPLEMENT';

const SERVER_VERSION = '0.3.0';
const MAX_TIMEOUT_SECONDS = 1800;
const DEFAULT_TIMEOUT_SECONDS = 600;
const parsedMaxTaskChars = Number(process.env.PEER_AGENTS_MAX_TASK_CHARS ?? 24_000);
const MAX_TASK_CHARS = Number.isSafeInteger(parsedMaxTaskChars)
  && parsedMaxTaskChars > 0
  && parsedMaxTaskChars <= 100_000
  ? parsedMaxTaskChars
  : 24_000;
const MAX_ANTIGRAVITY_ARGV_PROMPT_CHARS = 20_000;
const parsedDelegationDepth = Number(process.env.PEER_AGENTS_DEPTH ?? '0');
const DELEGATION_DEPTH = Number.isSafeInteger(parsedDelegationDepth) && parsedDelegationDepth >= 0
  ? parsedDelegationDepth
  : 1;

async function codexCatalog() {
  const catalogPath = path.join(process.env.CODEX_HOME ?? path.join(homedir(), '.codex'), 'models_cache.json');
  try {
    const raw = JSON.parse(await readFile(catalogPath, 'utf8'));
    return { models: parseCodexCatalog(raw), source: catalogPath, fetchedAt: raw.fetched_at ?? null,
      availability: 'Local CLI catalog; a successful execution is required to confirm account access.' };
  } catch {
    return { models: [], source: catalogPath, fetchedAt: null,
      availability: 'Catalog unavailable or invalid. Refresh model discovery in Codex before delegation.' };
  }
}

function toolText(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: redact(JSON.stringify(payload, null, 2)) }],
    ...(isError ? { isError: true } : {}),
  };
}

async function commandVersion(command: string): Promise<string | null> {
  try {
    const result = await runCapture(command, ['--version'], { timeoutSeconds: 10 });
    if (result.code !== 0) return null;
    return (result.stdout || result.stderr).trim() || null;
  } catch {
    return null;
  }
}

async function agyModels(): Promise<string[]> {
  try {
    const result = await runCapture(process.env.PEER_AGY_BIN ?? 'agy', ['models'], {
      timeoutSeconds: 20,
    });
    if (result.code !== 0) return [];
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/)[0])
      .filter((slug) => /^[a-z0-9][a-z0-9._-]*$/i.test(slug));
  } catch {
    return [];
  }
}

async function gitRoot(cwd: string): Promise<string | null> {
  try {
    const result = await runCapture('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      timeoutSeconds: 15,
    });
    if (result.code !== 0) return null;
    const root = result.stdout.trim();
    return root || null;
  } catch {
    return null;
  }
}

async function gitStatus(cwd: string): Promise<string | null> {
  const root = await gitRoot(cwd);
  if (!root) return null;
  const result = await runCapture('git', ['-C', root, 'status', '--porcelain=v1', '--untracked-files=all'], {
    timeoutSeconds: 20,
  });
  if (result.code !== 0) return null;
  return result.stdout;
}

function buildPrompt(args: {
  caller: AgentName;
  target: AgentName;
  task: string;
  mode: Mode;
  choice: ModelChoice;
  deliverable?: string;
}): string {
  const modeRules =
    args.mode === 'IMPLEMENT'
      ? [
        'You are working in an isolated temporary Git worktree.',
        'You may modify files in that worktree only.',
        'Do not commit, push, merge, deploy, or alter remote resources.',
        'Do not modify secrets or credentials.',
        'Keep the patch focused on the delegated task.',
      ]
      : [
        'READ-ONLY delegation: do not modify, create, delete, rename, or format repository files.',
        'Do not run commands whose purpose is to mutate repository state.',
        'Use permitted read tools for inspection. If permissions prevent access, report the limitation; do not bypass it.',
      ];

  return [
    'You are a delegated peer agent in a multi-agent engineering workflow.',
    'Delegation depth is already 1. Do not delegate further through MCP, agent CLIs, or subagents.',
    '',
    `CALLER: ${args.caller}`,
    `TARGET: ${args.target}`,
    `MODE: ${args.mode}`,
    `REQUESTED_MODEL: ${args.choice.model}`,
    `REQUESTED_EFFORT: ${args.choice.effort}`,
    '',
    'GOAL:',
    args.task,
    '',
    ...(args.deliverable ? ['DELIVERABLE:', args.deliverable, ''] : []),
    'CONSTRAINTS:',
    ...modeRules.map((rule) => `- ${rule}`),
    '- Never expose secrets, tokens, credentials, or sensitive environment values.',
    '- Verify material claims against repository evidence, runtime evidence, or authoritative documentation when available.',
    '- Do not claim tests/checks were performed unless they actually were.',
    '',
    'RETURN A COMPACT STRUCTURED RESULT WITH THESE HEADINGS:',
    'CONCLUSION',
    'FINDINGS',
    'EVIDENCE',
    'CONFIDENCE',
    'RISKS',
    'NEXT_ACTION',
    'TESTS_CHECKS',
    'UNVERIFIED',
  ].join('\n');
}

async function prepareImplementationWorktree(cwd: string): Promise<{
  baseSha: string;
  root: string;
  worktree: string;
  runId: string;
}> {
  const root = await gitRoot(cwd);
  if (!root) {
    throw new Error('IMPLEMENT mode requires a Git repository.');
  }

  const status = await gitStatus(root);
  if (status === null) {
    throw new Error('Could not inspect Git working-tree status.');
  }
  if (status.trim()) {
    throw new Error(
      'IMPLEMENT mode requires a clean primary working tree so the delegated patch is based on a known HEAD. Use READ_ONLY/REVIEW, or commit/stash the existing changes first.',
    );
  }

  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  // Keep the isolated worktree beside the repository so parent-level .codex/config.toml
  // layers can still be discovered by Codex. Fall back to the OS temp directory only
  // when a sibling path cannot be prepared.
  const repoName = path.basename(root).replace(/[^a-zA-Z0-9._-]/g, '_');
  let worktree = path.join(path.dirname(root), '.peer-agents-worktrees', `${repoName}-${runId}`);
  try {
    await mkdir(path.dirname(worktree), { recursive: true });
  } catch {
    worktree = path.join(tmpdir(), 'peer-agents', `${repoName}-${runId}`);
    await mkdir(path.dirname(worktree), { recursive: true });
  }

  const base = await runCapture('git', ['-C', root, 'rev-parse', 'HEAD'], { timeoutSeconds: 15 });
  if (base.code !== 0) throw new Error('Cannot resolve original worktree base');
  const baseSha = base.stdout.trim();
  const add = await runCapture('git', ['-C', root, 'worktree', 'add', '--detach', worktree, baseSha], {
    timeoutSeconds: 60,
  });
  if (add.code !== 0) {
    throw new Error(`Failed to create isolated worktree: ${add.stderr || add.stdout}`);
  }

  return { root, worktree, runId, baseSha };
}

async function runCodex(input: {
  prompt: string;
  cwd: string;
  choice: ModelChoice;
  mode: Mode;
  timeoutSeconds: number;
}): Promise<{ response: string; stderr: string; choice: ModelChoice; durationMs: number }> {
  const choice = input.choice;
  const args = [
    '--ask-for-approval',
    'never',
    'exec',
    '--ephemeral',
    '--cd',
    input.cwd,
    '--sandbox',
    input.mode === 'IMPLEMENT' ? 'workspace-write' : 'read-only',
    '--config',
    `model_reasoning_effort="${choice.effort}"`,
    '--config',
    'mcp_servers.peer-agents.enabled=false',
  ];
  if (choice.model) args.push('--model', choice.model);
  args.push('-');

  const env = {
    ...childEnvironment(process.env, 'codex'),
    PEER_AGENTS_DEPTH: String(DELEGATION_DEPTH + 1),
    PEER_AGENTS_ALLOWED_ROOTS: input.cwd,
  };
  const result = await runCapture(CODEX_BIN, args, {
    cwd: input.cwd,
    timeoutSeconds: input.timeoutSeconds,
    env,
    input: input.prompt,
  });

  if (result.timedOut) throw new Error(`Codex delegation timed out after ${input.timeoutSeconds}s.`);
  if (result.code !== 0) {
    throw new Error(`Codex delegation failed with exit code ${result.code}. ${result.stderr || result.stdout}`);
  }
  return {
    response: result.stdout.trim(),
    stderr: result.stderr.trim(),
    choice,
    durationMs: result.durationMs,
  };
}

async function runAntigravity(input: {
  prompt: string;
  cwd: string;
  choice: ModelChoice;
  mode: Mode;
  timeoutSeconds: number;
}): Promise<{
  response: string;
  stderr: string;
  choice: ModelChoice;
  durationMs: number;
  usage?: unknown;
  conversationId?: string;
}> {
  if (input.prompt.length > MAX_ANTIGRAVITY_ARGV_PROMPT_CHARS) {
    throw new Error(
      `Antigravity delegation prompt exceeds the Windows-safe argument limit (${MAX_ANTIGRAVITY_ARGV_PROMPT_CHARS} characters). Shorten the task or deliverable.`,
    );
  }
  const choice = input.choice;
  const args = [
    '-p',
    input.prompt,
    '--output-format',
    'json',
    '--effort',
    choice.effort,
    '--print-timeout',
    `${Math.ceil(input.timeoutSeconds / 60)}m`,
    '--mode',
    input.mode === 'IMPLEMENT' ? 'accept-edits' : 'plan',
    '--sandbox',
    '--add-dir',
    input.cwd,
  ];
  if (input.mode !== 'IMPLEMENT') args.push('--disable-slash-commands');
  if (choice.model) args.push('--model', choice.model);

  const env = {
    ...childEnvironment(process.env, 'antigravity'),
    PEER_AGENTS_DEPTH: String(DELEGATION_DEPTH + 1),
    PEER_AGENTS_ALLOWED_ROOTS: input.cwd,
  };
  const result = await runCapture(process.env.PEER_AGY_BIN ?? 'agy', args, {
    cwd: input.cwd,
    timeoutSeconds: input.timeoutSeconds + 15,
    env,
  });

  if (result.timedOut) throw new Error(`Antigravity delegation timed out after ${input.timeoutSeconds}s.`);
  if (result.code !== 0) {
    throw new Error(`Antigravity delegation failed with exit code ${result.code}. ${result.stderr || result.stdout}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Antigravity returned invalid JSON: ${truncate(result.stdout, 8_192)}`);
  }
  if (parsed.status !== 'SUCCESS') {
    throw new Error(`Antigravity delegation status ${String(parsed.status)}: ${String(parsed.error ?? '')}`);
  }

  const response = String(parsed.response ?? '').trim();
  const stderr = result.stderr.trim();

  const permissionDenied =
    /permission.*denied|auto-denied|soft-denied|required the ["']?command["']? permission/i.test(
      stderr,
    );

  if (!response && permissionDenied) {
    throw new Error(
      `Antigravity produced no result because a required permission was denied. ${truncate(stderr, 8192)}`,
    );
  }

  if (!response) {
    throw new Error(
      `Antigravity reported SUCCESS but returned an empty response. ${truncate(stderr, 8192)}`,
    );
  }

  return {
    response,
    stderr,
    choice,
    durationMs: result.durationMs,
    usage: parsed.usage,
    conversationId: parsed.conversation_id,
  };
}

function createServer(): McpServer {
  const server = new McpServer(
    { name: 'peer-agents', version: SERVER_VERSION },
    {
      instructions:
        'Use peer_capabilities to discover models and supported efforts. The lead must choose an exact model and effort per task; there are no capability tiers or automatic substitutions. Do not delegate lightweight mechanical work to Codex. Depth is limited to one. READ_ONLY is the default; IMPLEMENT returns an isolated patch for lead verification.',
    },
  );

  server.registerTool(
    'peer_capabilities',
    {
      title: 'Peer agent capabilities',
      description:
        'Discover CLI availability, model catalogs, supported reasoning efforts and restrictions without spending a model turn. Catalog listing does not guarantee account access.',
      inputSchema: z.object({}),
    },
    async () => {
      const [codexVersion, agyVersion, models, catalog] = await Promise.all([
        commandVersion(CODEX_BIN),
        commandVersion(process.env.PEER_AGY_BIN ?? 'agy'),
        agyModels(),
        codexCatalog(),
      ]);
      return toolText({
        bridgeVersion: SERVER_VERSION,
        delegationDepth: DELEGATION_DEPTH,
        maxDelegationDepth: 1,
        codex: {
          available: Boolean(codexVersion),
          version: codexVersion,
          ...catalog,
          workPolicy: 'Never delegate lightweight mechanical work to Codex; use direct tools or Antigravity fast models.',
        },
        antigravity: {
          available: Boolean(agyVersion),
          version: agyVersion,
          models,
          efforts: ['low', 'medium', 'high'],
          permissionPolicy: 'CLI permissions enforced; no approval bypass.',
        },
        modes: {
          READ_ONLY: 'Peer inspects/reasons but must not modify the primary working tree.',
          REVIEW: 'Read-only independent review of existing work.',
          IMPLEMENT:
            'Peer works in an isolated temporary Git worktree; the bridge exports a patch under ~/.peer-agents/runs and never applies it automatically.',
        },
        workingDirectoryPolicy:
          'Delegation requires a Git repository inside PEER_AGENTS_ALLOWED_ROOTS, or inside the repository that launched the MCP server when no roots are configured.',
      });
    },
  );

  server.registerTool(
    'delegate_peer',
    {
      title: 'Delegate to peer agent',
      description:
        'Delegate one bounded work package with an exact model and supported effort selected by the lead from peer_capabilities. No automatic fallback. Do not use Codex for lightweight mechanical work. Depth is one; READ_ONLY is default; IMPLEMENT returns an isolated patch.',
      inputSchema: z.strictObject({
        caller: z.enum(['codex', 'antigravity']).describe('The lead agent calling this tool.'),
        task: z
          .string()
          .min(1)
          .max(MAX_TASK_CHARS)
          .describe('Smallest self-contained work package the peer should perform.'),
        cwd: z
          .string()
          .refine((value) => path.isAbsolute(value), 'cwd must be an absolute path')
          .optional()
          .describe('Absolute project/repository directory. Defaults to the MCP server working directory.'),
        mode: z.enum(['READ_ONLY', 'REVIEW', 'IMPLEMENT']).default('READ_ONLY'),
        model: z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
          .describe('Exact peer model from peer_capabilities, selected by the lead.'),
        effort: effortSchema.describe('Supported reasoning effort for this exact model; not a capability tier.'),
        selectionReason: z.string().min(10).max(2000)
          .describe('Why this model and effort fit the task, risk, context and verification needs. Codex must not be used as a lightweight worker.'),
        deliverable: z.string().max(4_000).optional(),
        timeoutSeconds: z.number().int().min(30).max(MAX_TIMEOUT_SECONDS).default(DEFAULT_TIMEOUT_SECONDS),
      }),
    },
    async ({ caller, task, cwd, mode, model, effort, selectionReason, deliverable, timeoutSeconds }) => {
      if (DELEGATION_DEPTH >= 1) {
        return toolText(
          {
            ok: false,
            error: 'Delegation depth limit reached. A delegated peer may not delegate back through peer-agents.',
            delegationDepth: DELEGATION_DEPTH,
          },
          true,
        );
      }

      const target: AgentName = caller === 'codex' ? 'antigravity' : 'codex';
      let requestedCwd: string;
      try {
        requestedCwd = (await authorizeWorkingDirectory(cwd ?? process.cwd())).cwd;
      } catch (error) {
        return toolText(
          { ok: false, error: error instanceof Error ? error.message : String(error) },
          true,
        );
      }

      let executionCwd = requestedCwd;
      let isolated:
        | { root: string; worktree: string; runId: string }
        | undefined;
      let beforeStatus: string | null = null;

      try {
        const choice = validateChoice(target, model, effort,
          target === 'codex' ? (await codexCatalog()).models : [],
          target === 'antigravity' ? await agyModels() : []);
        if (mode === 'IMPLEMENT') {
          isolated = await prepareImplementationWorktree(requestedCwd);
          executionCwd = isolated.worktree;
        } else {
          beforeStatus = await gitStatus(requestedCwd);
        }

        const prompt = buildPrompt({ caller, target, task, mode, choice, deliverable });
        const result =
          target === 'codex'
            ? await runCodex({ prompt, cwd: executionCwd, choice, mode, timeoutSeconds })
            : await runAntigravity({ prompt, cwd: executionCwd, choice, mode, timeoutSeconds });

        let policyViolation: string | undefined;
        if (mode !== 'IMPLEMENT' && beforeStatus !== null) {
          const afterStatus = await gitStatus(requestedCwd);
          if (afterStatus !== null && afterStatus !== beforeStatus) {
            policyViolation =
              'READ_ONLY/REVIEW policy violation detected: repository status changed during delegation. peer-agents did not revert anything automatically; inspect the working tree before continuing.';
          }
        }

        let patch: ImplementationPatch | undefined;
        if (isolated) {
          patch = await finalizeImplementationWorktree({ ...isolated, target });
        }

        return toolText({
          ok: !policyViolation,
          caller,
          target,
          mode,
          selectionReason,
          model: result.choice.model,
          effort: result.choice.effort,
          modelEvidence: 'Explicit CLI arguments; effective backend model is not independently attested.',
          modelFallbackApplied: result.choice.fallback,
          durationSeconds: Number((result.durationMs / 1000).toFixed(2)),
          response: result.response,
          ...(target === 'antigravity'
            ? {
              antigravityUsage: 'usage' in result ? result.usage : undefined,
              antigravityConversationId:
                'conversationId' in result ? result.conversationId : undefined,
            }
            : {}),
          diagnostics: result.stderr ? truncate(result.stderr, 16_384) : undefined,
          policyViolation,
          implementationPatch: patch,
          integration:
            patch?.patchPath
              ? `Lead agent must inspect the patch, then may apply it explicitly with: git apply --check "${patch.patchPath}" && git apply "${patch.patchPath}"`
              : undefined,
        }, Boolean(policyViolation));
      } catch (error) {
        return toolText(
          {
            ok: false,
            caller,
            target,
            mode,
            model,
            effort,
            selectionReason,
            error: error instanceof Error ? error.message : String(error),
            temporaryWorktree: isolated?.worktree,
          },
          true,
        );
      }
    },
  );

  return server;
}

function resolveCodexBin(): string {
  const explicit = process.env.PEER_CODEX_BIN?.trim();

  if (explicit && existsSync(explicit)) {
    return explicit;
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;

    if (appData) {
      const nativeCodex = path.join(
        appData,
        'npm',
        'node_modules',
        '@openai',
        'codex',
        'node_modules',
        '@openai',
        'codex-win32-x64',
        'vendor',
        'x86_64-pc-windows-msvc',
        'bin',
        'codex.exe',
      );

      if (existsSync(nativeCodex)) {
        return nativeCodex;
      }
    }
  }

  return 'codex';
}

const CODEX_BIN = resolveCodexBin();

void serveStdio(createServer);
console.error(`[peer-agents] MCP server ${SERVER_VERSION} running on stdio`);
