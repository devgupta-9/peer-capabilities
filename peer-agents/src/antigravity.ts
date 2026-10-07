import type { ModelChoice } from './model-policy.js';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { runCapture, truncate, type CaptureResult } from './process.js';
import { childEnvironment, redact } from './security.js';

export const toolEvidenceHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const toolPathHash = (value: string) => toolEvidenceHash(process.platform === 'win32'
  ? path.resolve(value).toLowerCase() : path.resolve(value));
export type AntigravityToolEvidence = { tool: string; commandHash?: string; cwdHash?: string;
  cwdSource?: 'tool' | 'session'; gitRootHash?: string; pathHash?: string };

export type AntigravityInput = {
  prompt: string;
  cwd: string;
  choice: ModelChoice;
  mode: 'READ_ONLY' | 'REVIEW' | 'IMPLEMENT';
  timeoutSeconds: number;
  sandboxMode?: 'required' | 'permissions-only';
};

export function antigravitySandboxMode(value = process.env.PEER_AGY_SANDBOX_MODE): 'required' | 'permissions-only' {
  if (!value || value === 'required') return 'required';
  if (value === 'permissions-only') return value;
  throw new Error('Invalid PEER_AGY_SANDBOX_MODE. Use required or explicitly opt into permissions-only.');
}

/** AGY 1.2.x supports NDJSON stdin; never place a task in Windows argv. */
export function antigravityCommand(input: AntigravityInput) {
  return {
    args: ['--input-format', 'stream-json', '--output-format', 'stream-json',
      '--model', input.choice.model, '--effort', input.choice.effort,
      '--print-timeout', `${input.timeoutSeconds}s`, '--mode',
      input.mode === 'IMPLEMENT' ? 'accept-edits' : 'plan',
      input.sandboxMode === 'permissions-only' ? '--sandbox=false' : '--sandbox', '--add-dir', input.cwd],
    input: JSON.stringify({ event: 'user', message: { content: input.prompt } }) + '\n',
  };
}

export function parseAntigravityResult(result: CaptureResult) {
  if (result.timedOut) throw new Error('Antigravity invocation timed out. No retry or model substitution was attempted.');
  if (result.cancelled) throw new Error('Antigravity invocation cancelled.');
  if (result.stdoutTruncated || result.stderrTruncated) throw new Error('Antigravity output exceeded the capture limit; the result is incomplete.');
  if (/permission.*denied|auto-denied|soft-denied|required the ["']?command["']? permission/i.test(result.stderr)) {
    throw new Error('Antigravity was blocked by a required permission. Headless mode cannot ask for approval. Review the exact command in official CLI permissions; existing deny/ask rules take precedence. No bypass was attempted.');
  }
  if (result.code !== 0) throw new Error(`Antigravity exited ${result.code}: ${truncate(redact(result.stderr || result.stdout), 8192)}`);
  let terminal: Record<string, unknown> | undefined;
  const toolFailures: { tool: string; message: string }[] = [];
  const toolEvidence: AntigravityToolEvidence[] = [];
  let sessionCwd: string | undefined;
  let initialized = false;
  let sawStep = false;
  for (const line of result.stdout.split(/\r?\n/).filter(line => line.trim())) {
    let event;
    try { event = JSON.parse(line); } catch { throw new Error('Antigravity returned invalid stream JSON.'); }
    if (event?.event === 'init') {
      if (initialized || sawStep || terminal) throw new Error('Antigravity returned ambiguous session initialization.');
      initialized = true;
      const cwd = event.init?.cwd;
      if (typeof cwd === 'string' && path.isAbsolute(cwd)) sessionCwd = cwd;
    }
    const step = event?.step_update;
    if (step) sawStep = true;
    if (step?.tool_info?.error) {
      const message = String(step.tool_info.error.message ?? 'tool failed');
      if (/exebox:|sandbox configuration|permission.*denied|auto-denied/i.test(message)) {
        throw new Error(`Antigravity tool could not execute: ${truncate(redact(message), 2048)} No automatic permission bypass was attempted.`);
      }
      if (toolFailures.length < 20) toolFailures.push({ tool: redact(String(step.tool_name ?? 'unknown')), message: truncate(redact(message), 2048) });
    } else if (step?.state === 'DONE' && typeof step.tool_info?.output === 'string' && toolEvidence.length < 1000) {
      const info = step.tool_info;
      const tool = step.tool_name ?? info.name;
      // Allowlisted, hashed observations only: no raw file contents, paths, or arbitrary arguments.
      if (tool === 'run_command' && typeof info.parameters?.CommandLine === 'string') {
        // CLI 1.3.x emits CommandLine only; its init event establishes the session cwd.
        // Explicit overrides, including invalid ones, must never inherit that default.
        const explicitCwd = Object.hasOwn(info.parameters, 'Cwd');
        const cwd = explicitCwd ? info.parameters.Cwd : sessionCwd;
        const rootOutput = info.output.trim();
        toolEvidence.push({ tool, commandHash: toolEvidenceHash(info.parameters.CommandLine),
          ...(typeof cwd === 'string' && path.isAbsolute(cwd)
            ? { cwdHash: toolPathHash(cwd), cwdSource: explicitCwd ? 'tool' as const : 'session' as const } : {}),
          ...(info.parameters.CommandLine === 'git rev-parse --show-toplevel' && path.isAbsolute(rootOutput)
            && !/[\r\n]/.test(rootOutput) ? { gitRootHash: toolPathHash(rootOutput) } : {}) });
      } else if (tool === 'view_file' && typeof info.parameters?.AbsolutePath === 'string') {
        toolEvidence.push({ tool, pathHash: toolPathHash(info.parameters.AbsolutePath) });
      }
    }
    if (event?.event === 'result') {
      if (terminal) throw new Error('Antigravity returned multiple terminal results for one task.');
      terminal = event.result;
    }
  }
  if (!terminal || terminal.status !== 'SUCCESS') {
    throw new Error(`Antigravity did not complete successfully: ${redact(String(terminal?.status ?? 'missing result'))}. ${redact(JSON.stringify(terminal?.error ?? ''))}`);
  }
  if (Array.isArray(terminal.denied_actions) && terminal.denied_actions.length) {
    throw new Error('Antigravity reported denied actions; required work may be incomplete. Review scoped permissions before retrying.');
  }
  const response = typeof terminal.response === 'string' ? terminal.response.trim() : '';
  if (!response) throw new Error('Antigravity reported SUCCESS without a response.');
  return { response, stderr: result.stderr.trim(), durationMs: result.durationMs,
    toolFailures, toolEvidence, usage: terminal.usage, conversationId: typeof terminal.conversation_id === 'string' ? terminal.conversation_id : undefined };
}

export async function runAntigravity(input: AntigravityInput, depth: number) {
  const command = antigravityCommand({ ...input, sandboxMode: antigravitySandboxMode(input.sandboxMode) });
  const result = await runCapture(process.env.PEER_AGY_BIN ?? 'agy', command.args, {
    cwd: input.cwd, input: command.input, timeoutSeconds: input.timeoutSeconds + 15,
    // Stream output includes progress and tool events as well as the final response.
    maxOutputBytes: 8 * 1024 * 1024,
    env: { ...childEnvironment(process.env, 'antigravity'),
      PEER_AGENTS_DEPTH: String(depth + 1), PEER_AGENTS_ALLOWED_ROOTS: input.cwd },
  });
  return { ...parseAntigravityResult(result), choice: input.choice };
}

type Discovery = { models: string[]; status: 'AVAILABLE' | 'TIMEOUT' | 'UNAVAILABLE';
  observedAt: string; cached: boolean; error?: string };

/** Cache successful observations briefly; never turn a discovery failure into a model rejection. */
export function discoverAntigravityModels(options: { command: string; capture?: typeof runCapture; ttlMs?: number }) {
  const capture = options.capture ?? runCapture;
  let cached: Discovery | undefined;
  let expiresAt = 0;
  let pending: Promise<Discovery> | undefined;
  return async (): Promise<Discovery> => {
    if (cached && Date.now() < expiresAt) return { ...cached, cached: true };
    if (pending) return pending;
    pending = (async (): Promise<Discovery> => {
      const observedAt = new Date().toISOString();
      try {
        const result = await capture(options.command, ['models'], { timeoutSeconds: 90, env: childEnvironment(process.env, 'antigravity') });
        if (result.timedOut) return { models: [], observedAt, cached: false, status: 'TIMEOUT',
          error: 'Antigravity model discovery timed out after 90s. Check provider connectivity and official login, then retry discovery.' };
        if (result.code !== 0 || result.cancelled || result.stdoutTruncated) throw new Error('catalog command failed');
        const models = [...new Set(result.stdout.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)
          .map(line => line.trim()).filter(line => !/^(?:Fetching available models|Available models\s*:)/i.test(line))
          .map(line => line.split(/\s+/)[0]).filter(slug => /^[a-z0-9][a-z0-9._-]*$/i.test(slug)))];
        if (!models.length) throw new Error('empty catalog');
        cached = { models, observedAt, status: 'AVAILABLE', cached: false };
        expiresAt = Date.now() + (options.ttlMs ?? 60_000);
        return cached;
      } catch {
        return { models: [], observedAt, status: 'UNAVAILABLE', cached: false,
          error: 'Antigravity model discovery is unavailable. Run agy models and check the official provider login; no model was substituted.' };
      }
    })();
    try { return await pending; } finally { pending = undefined; }
  };
}
