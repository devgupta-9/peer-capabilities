import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import * as z from 'zod/v4';
import { parseCodexCatalog, validateChoice, type Effort } from '../model-policy.js';
import { runCapture } from '../process.js';
import { antigravityCommand, discoverAntigravityModels, parseAntigravityResult } from '../antigravity.js';
import { childEnvironment, redact, assertNonSecret } from '../security.js';
import type { AgentAdapter, AgentResult, Authentication, Availability, Choice, Invocation, Observation } from './contracts.js';

export const adapterConfigSchema = z.object({
  id: z.enum(['codex', 'antigravity']), executable: z.string().min(1).optional(),
  experimental: z.boolean().default(false),
  sandboxMode: z.enum(['required', 'permissions-only']).default('required'),
  profiles: z.array(z.object({
    model: z.string().min(1), effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
    competence: z.number().min(0).max(10), cost: z.number().nonnegative(),
    contextWindow: z.number().int().positive(), latency: z.number().nonnegative().default(1),
  }).strict()).default([]),
}).strict();
type Config = z.input<typeof adapterConfigSchema>;
type Provider = 'codex' | 'antigravity';

export function normalizeFailure(message: string, timedOut: boolean): Availability {
  if (timedOut) return 'TIMEOUT';
  if (/quota.*(?:exhaust|exceed)|usage limit/i.test(message)) return 'QUOTA_EXHAUSTED';
  if (/rate.?limit|too many requests|429/i.test(message)) return 'RATE_LIMITED';
  if (/authenticat|please (?:log.?in|sign.?in)|not logged in/i.test(message)) return 'AUTH_REQUIRED';
  if (/model.*(?:unavailable|not found|unsupported)/i.test(message)) return 'MODEL_UNAVAILABLE';
  if (/permission.*denied|policy.*block|auto-denied|denied actions|blocked by a required permission|exebox:|sandbox configuration/i.test(message)) return 'POLICY_BLOCKED';
  if (/service unavailable|503|connection refused/i.test(message)) return 'SERVICE_UNAVAILABLE';
  return 'EXECUTION_ERROR';
}
export function providerCommand(provider: Provider, input: Pick<Invocation, 'cwd' | 'role' | 'choice' | 'prompt'>,
  sandboxMode: 'required' | 'permissions-only' = 'required') {
  if (provider === 'codex') return {
    args: ['--ask-for-approval', 'never', 'exec', '--ignore-user-config', '--ephemeral', '--json',
      '--cd', input.cwd, '--sandbox', input.role === 'lead' ? 'workspace-write' : 'read-only',
      '--config', 'model_reasoning_effort=' + JSON.stringify(input.choice.effort),
      '--config', 'mcp_servers.peer-agents.enabled=false', '--config', 'mcp_servers.peer-capabilities.enabled=false',
      '--model', input.choice.model, '-'],
    input: input.prompt,
  };
  return antigravityCommand({ cwd: input.cwd, prompt: input.prompt,
    choice: { model: input.choice.model, effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']).parse(input.choice.effort), fallback: false },
    mode: input.role === 'lead' ? 'IMPLEMENT' : 'READ_ONLY', timeoutSeconds: 600, sandboxMode });
}
async function executable(config: Config): Promise<string> {
  if (config.executable) {
    if (/\.(cmd|bat|ps1)$/i.test(config.executable)) throw new Error('Native executable required; shell shims are not accepted');
    return config.executable;
  }
  if (config.id === 'antigravity') return process.env.PEER_AGY_BIN ?? 'agy';
  if (process.env.PEER_CODEX_BIN) return process.env.PEER_CODEX_BIN;
  if (process.platform !== 'win32') return 'codex';
  const root = path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai');
  async function find(dir: string, depth: number): Promise<string | undefined> {
    if (depth > 6 || !existsSync(dir)) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === 'codex.exe') return full;
      if (entry.isDirectory()) { const result = await find(full, depth + 1); if (result) return result; }
    }
  }
  return await find(root, 0) ?? 'codex.exe';
}
const reviewSchema = z.object({ outcome: z.enum(['APPROVE', 'REQUEST_CHANGES', 'BLOCKED']), findings: z.array(z.string()) }).strict();
export class ProviderAdapter implements AgentAdapter {
  readonly id: Provider;
  private config: z.output<typeof adapterConfigSchema>;
  constructor(config: Config, private verification?: Observation, private capture: typeof runCapture = runCapture) {
    assertNonSecret(config);
    this.config = adapterConfigSchema.parse(config); this.id = config.id;
  }
  loginInstructions(): string {
    return this.id === 'codex' ? 'Run the official codex login command, then verify the selected model.'
      : 'Run an interactive agy session and complete official sign-in, then verify the selected model.';
  }
  async discover(): Promise<{ observation: Observation; choices: Choice[] }> {
    const observation: Observation = { component: this.id, presence: 'DISCOVERED', authentication: 'UNKNOWN',
      verification: 'UNVERIFIED', observedAt: new Date().toISOString(), scope: 'CLI discovery only' };
    let command: string;
    try {
      command = await executable(this.config);
      const version = await this.capture(command, ['--version'], { timeoutSeconds: 10, env: childEnvironment(process.env, this.id) });
      if (version.code !== 0) return { observation: { ...observation, verification: 'UNAVAILABLE' }, choices: [] };
      observation.presence = 'INSTALLED'; observation.version = redact(version.stdout || version.stderr).trim().slice(0, 128);
    } catch { return { observation: { ...observation, verification: 'UNAVAILABLE' }, choices: [] }; }
    let codexModels: ReturnType<typeof parseCodexCatalog> = [];
    let agyModels: string[] = [];
    if (this.id === 'codex') {
      try {
        codexModels = parseCodexCatalog(JSON.parse(await readFile(path.join(process.env.CODEX_HOME ?? path.join(homedir(), '.codex'), 'models_cache.json'), 'utf8')));
      } catch { /* absent catalog never implies model access */ }
      const auth = await this.capture(command, ['login', 'status'], { timeoutSeconds: 10, env: childEnvironment(process.env, 'codex') });
      const status = auth.stdout + auth.stderr;
      observation.authentication = auth.code === 0 && /logged in/i.test(status) ? 'AUTHENTICATED'
        : /not logged in|authentication required/i.test(status) ? 'AUTH_REQUIRED' : 'UNKNOWN';
    } else {
      agyModels = (await discoverAntigravityModels({ command, capture: this.capture })()).models;
    }
    if (this.verification?.verification === 'VERIFIED' && this.verification.version === observation.version &&
      this.verification.expiresAt && Date.parse(this.verification.expiresAt) > Date.now()) {
      observation.authentication = 'AUTHENTICATED';
      observation.verification = 'VERIFIED'; observation.scope = this.verification.scope;
      observation.expiresAt = this.verification.expiresAt;
    }
    const choices: Choice[] = [];
    for (const profile of this.config.profiles) {
      try { validateChoice(this.id, profile.model, profile.effort, codexModels, agyModels); } catch { continue; }
      choices.push({
        agent: this.id, model: profile.model, effort: profile.effort, efforts: this.id === 'codex'
          ? codexModels.find(c => c.model === profile.model)!.efforts : [profile.effort],
        roles: ['lead', 'reviewer', 'consultant'], competence: profile.competence, cost: profile.cost,
        latency: profile.latency, contextWindow: profile.contextWindow,
        authentication: observation.authentication,
        availability: this.config.experimental ? 'AVAILABLE_LIMITED' : 'POLICY_BLOCKED',
        provider: this.id, quotaPool: this.id + ':provider-owned-account',
      });
    }
    return { observation, choices };
  }
  async verify(cwd: string): Promise<Observation> {
    const discovery = await this.discover();
    const choice = discovery.choices[0];
    if (!choice) throw new Error('No valid exact model profile to verify');
    if (!this.config.experimental) throw new Error('Live adapters are not certified; explicit experimental opt-in is required');
    const result = await this.invoke({ id: 'verification', taskId: 'verification', cwd, role: 'consultant', choice,
      prompt: 'Do not use tools, read files, change anything, or delegate. Reply with only PEER_OK.' });
    const verified = result.availability === 'AVAILABLE' && result.response.trim() === 'PEER_OK';
    this.verification = { ...discovery.observation,
      authentication: verified ? 'AUTHENTICATED' : result.availability === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'UNKNOWN',
      verification: verified ? 'VERIFIED' : 'UNAVAILABLE', scope: 'model response only (tools unverified): ' + choice.model,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), reason: result.availability,
    };
    return this.verification;
  }
  async execute(input: Invocation): Promise<AgentResult> {
    const depth = Number(process.env.PEER_AGENTS_DEPTH ?? 0);
    if (!Number.isSafeInteger(depth) || depth !== 0) return { availability: 'POLICY_BLOCKED', response: 'Recursive dispatch prohibited' };
    const { choices } = await this.discover();
    if (!choices.some(c => c.model === input.choice.model && c.efforts.includes(input.choice.effort)
      && c.authentication === 'AUTHENTICATED' && c.availability !== 'POLICY_BLOCKED')) {
      return { availability: 'POLICY_BLOCKED', response: 'Exact choice/authentication/experimental policy not satisfied' };
    }
    return this.invoke(input);
  }
  private async invoke(input: Invocation): Promise<AgentResult> {
    const prompt = input.role === 'reviewer'
      ? input.prompt + '\nReturn ONLY JSON: {"outcome":"APPROVE|REQUEST_CHANGES|BLOCKED","findings":["material findings with source evidence"]}.'
      : input.prompt;
    const request = providerCommand(this.id, { ...input, prompt }, this.config.sandboxMode);
    try {
      const result = await this.capture(await executable(this.config), request.args, {
        cwd: input.cwd, timeoutSeconds: 615, input: request.input, signal: input.signal,
        maxOutputBytes: this.id === 'antigravity' ? 8 * 1024 * 1024 : undefined,
        env: { ...childEnvironment(process.env, this.id), PEER_AGENTS_DEPTH: '1', PEER_AGENTS_ALLOWED_ROOTS: input.cwd },
      });
      if (result.code !== 0 || result.timedOut || result.cancelled || result.stdoutTruncated || result.stderrTruncated) {
        return { availability: normalizeFailure(result.stderr + result.stdout, result.timedOut || result.cancelled), response: 'Provider invocation failed; raw diagnostics withheld' };
      }
      const events = result.stdout.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
      let response: string;
      let session: string | undefined;
      if (this.id === 'antigravity') {
        const parsed = parseAntigravityResult(result);
        if (parsed.toolFailures.length) return { availability: 'EXECUTION_ERROR', response: 'Provider reported tool failures; review is not verified' };
        response = parsed.response; session = parsed.conversationId;
      } else {
        if (events.at(-1)?.type !== 'turn.completed' || events.some(event => event.type === 'turn.failed' || event.type === 'error')) {
          return { availability: 'EXECUTION_ERROR', response: 'Provider turn failed or did not complete' };
        }
        response = events.findLast(event => event.type === 'item.completed' && event.item?.type === 'agent_message')?.item.text ?? '';
      }
      if (!response.trim()) return { availability: 'EXECUTION_ERROR', response: 'Empty provider response' };
      const review = input.role === 'reviewer' ? reviewSchema.parse(JSON.parse(response)) : undefined;
      return { availability: 'AVAILABLE', response: redact(response), ...(session ? { session } : {}), ...(review ? { review } : {}) };
    } catch (error) { return { availability: normalizeFailure(error instanceof Error ? error.message : '', false), response: 'Provider execution or result validation failed; no raw diagnostic persisted' }; }
  }
}
