import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import { assertNonSecret } from '../security.js';
import { availability } from './contracts.js';
import type { EnvironmentManager } from './environment.js';
import { digest } from './identity.js';
import { resourceObservationScopeSchema, type ResourceObservation, type ResourceObservationScope } from './resource-observations.js';
import { resolveResource, type CapabilityContract } from './resources.js';

const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const requestSchema = z.object({ scope: resourceObservationScopeSchema,
  resourceRevision: z.number().int().positive(),
  timeoutMs: z.number().int().min(1).max(600000),
  ttlMs: z.number().int().min(1).max(900000),
}).strict();
const contextSchema = z.object({
  authContextId: id, handle: id, frontendVersion: id, configurationDigest: hash,
  // Non-secret identity/generation from the provider-owned context, not a token hash.
  identityDigest: hash, expiresAt: z.iso.datetime(),
  authentication: z.enum(['UNKNOWN', 'NOT_REQUIRED', 'AUTH_REQUIRED', 'AUTHENTICATED']),
}).strict();
const probeSchema = z.object({
  attemptId: z.uuid(), scope: resourceObservationScopeSchema, model: z.string().min(1).max(256),
  contextDigest: hash, availability,
  // Trusted collector's observed checks, never the model's assertion of success.
  checks: z.array(z.object({ id, passed: z.boolean() }).strict()).max(256)
    .refine(checks => new Set(checks.map(c => c.id)).size === checks.length),
  evidenceReference: hash,
}).strict();
export type VerificationContext = z.infer<typeof contextSchema>;
export type ScopedProbeResult = z.infer<typeof probeSchema>;
export type ScopedProbeRequest = {
  attemptId: string; scope: ResourceObservationScope; model: string;
  contract: CapabilityContract; contextDigest: string;
};
/** Trusted runtime code only. No dynamic module loading, CLI/MCP writer or model
 * supplied callbacks. Implementations must observe provider context and runtime
 * checks independently, honor cancellation and reconcile their child processes. */
export interface ScopedVerificationCollector {
  readonly id: string;
  readonly frontendId: string;
  requiredChecks(contract: CapabilityContract): string[];
  observeContext(signal: AbortSignal): Promise<VerificationContext>;
  // Pin the provider-owned context for execution. Returned contextDigest must
  // identify that actual execution context, not merely echo the request. Two
  // matching status reads alone cannot detect a switch-and-switch-back race.
  probe(request: ScopedProbeRequest, signal: AbortSignal): Promise<ScopedProbeResult>;
}
type Store = Pick<EnvironmentManager, 'readResources' | 'recordResourceObservation' | 'getResourceObservation'>;
export type VerificationCollection = {
  status: 'VERIFIED' | 'UNAVAILABLE';
  reason: 'CHECKS_PASSED' | 'CHECKS_FAILED' | 'AUTH_REQUIRED' | 'CONTEXT_UNVERIFIED' | 'CONTEXT_CHANGED'
    | 'INVALID_COLLECTOR_RESULT' | 'COLLECTOR_FAILED' | 'CANCELLED' | 'TIMEOUT';
  observation: ResourceObservation;
};

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  try { assertNonSecret(value); return schema.parse(value); }
  catch { throw new Error('INVALID_COLLECTOR_RESULT'); }
}
const usable = (value: string) => ['AVAILABLE', 'AVAILABLE_LIMITED', 'QUOTA_LOW'].includes(value);
const authenticated = (value: string) => ['AUTHENTICATED', 'NOT_REQUIRED'].includes(value);
const contextIdentity = (c: VerificationContext) => digest({ authContextId: c.authContextId, handle: c.handle,
  frontendVersion: c.frontendVersion, configurationDigest: c.configurationDigest, identityDigest: c.identityDigest });

/** Suspend old success before external work; complete only the still-current
 * attempt against its original resource revision. Failed/stale writes throw. */
export async function collectResourceVerification(store: Store, collector: ScopedVerificationCollector,
  value: unknown, signal?: AbortSignal): Promise<VerificationCollection> {
  const request = parse(requestSchema, value);
  parse(id, collector.id); parse(id, collector.frontendId);
  const depth = Number(process.env.PEER_AGENTS_DEPTH ?? 0);
  if (!Number.isSafeInteger(depth) || depth !== 0) throw new Error('Recursive verification prohibited');
  if (signal?.aborted) throw new Error('VERIFICATION_CANCELLED');
  const snapshot = store.readResources();
  if (!snapshot || snapshot.revision !== request.resourceRevision) throw new Error('RESOURCE_REVISION_CONFLICT');
  const resolved = resolveResource(snapshot.catalog, request.scope, { schemaVersion: 1,
    role: request.scope.role, effort: request.scope.effort, features: [], minimumCompetence: 0, requiredContext: 1 });
  if (resolved.frontend.id !== collector.frontendId) throw new Error('RESOURCE_FRONTEND_MISMATCH');
  let checks: string[];
  try {
    checks = parse(z.array(id).min(1).max(256).refine(a => new Set(a).size === a.length),
      collector.requiredChecks(structuredClone(resolved.contract)));
  } catch { throw new Error('INVALID_COLLECTOR_RESULT'); }
  const started = Date.now(), attemptId = randomUUID();
  const pending = store.recordResourceObservation({ scope: request.scope, resourceRevision: snapshot.revision,
    authentication: 'UNKNOWN', availability: 'UNKNOWN', verification: 'UNVERIFIED',
    observedAt: new Date(started).toISOString(), expiresAt: new Date(started + request.ttlMs).toISOString(),
    evidence: { method: 'DISCOVERY', reference: digest({ collector: collector.id, attemptId, state: 'PENDING' }) },
  });
  const ensureCurrent = () => {
    if (store.readResources()?.revision !== snapshot.revision) throw new Error('RESOURCE_REVISION_CONFLICT');
    const latest = store.getResourceObservation(request.scope);
    if (latest.status !== 'CURRENT' || digest(latest.observation) !== digest(pending)) throw new Error('RESOURCE_OBSERVATION_CONFLICT');
  };
  const controller = new AbortController();
  let aborted: 'TIMEOUT' | 'CANCELLED' | undefined;
  const cancel = () => { aborted ??= 'CANCELLED'; controller.abort(); };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(() => { aborted ??= 'TIMEOUT'; controller.abort(); }, request.timeoutMs);
  // Race even a non-cooperative collector; its late result can never persist.
  const bounded = async <T>(action: () => Promise<T>): Promise<T> => {
    if (controller.signal.aborted) throw new Error(aborted);
    let rejectAbort: () => void = () => {};
    const stop = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(new Error(aborted)); });
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
    try { return await Promise.race([Promise.resolve().then(() => {
      if (Date.now() >= started + request.timeoutMs) { aborted ??= 'TIMEOUT'; controller.abort(); }
      if (controller.signal.aborted) throw new Error(aborted);
      return action();
    }), stop]); }
    finally { controller.signal.removeEventListener('abort', rejectAbort); }
  };
  const matches = (context: VerificationContext) => context.authContextId === resolved.authContext.id &&
    context.handle === resolved.authContext.handle && context.frontendVersion === request.scope.frontendVersion &&
    context.configurationDigest === request.scope.configurationDigest && Date.parse(context.expiresAt) > Date.now();
  let reason: VerificationCollection['reason'] = 'COLLECTOR_FAILED';
  let authentication: ResourceObservation['authentication'] = 'UNKNOWN';
  let available: ResourceObservation['availability'] = 'EXECUTION_ERROR';
  let method: ResourceObservation['evidence']['method'] = 'DISCOVERY';
  let verified = false, expiry = started + request.ttlMs, reference = digest({ attemptId, state: 'FAILED' });
  try {
    const before = parse(contextSchema, await bounded(() => collector.observeContext(controller.signal)));
    method = 'OFFICIAL_STATUS';
    if (!matches(before)) reason = 'CONTEXT_CHANGED';
    else if (!authenticated(before.authentication)) {
      reason = before.authentication === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'CONTEXT_UNVERIFIED';
      authentication = before.authentication; available = reason === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'UNKNOWN';
    } else {
      ensureCurrent();
      method = 'FUNCTIONAL_PROBE';
      // No raw context or auth handle is sent to the probe/model prompt.
      const probe = parse(probeSchema, await bounded(() => collector.probe({ attemptId,
        scope: structuredClone(request.scope), model: resolved.model.model, contract: structuredClone(resolved.contract),
        contextDigest: contextIdentity(before) }, controller.signal)));
      if (probe.attemptId !== attemptId || digest(probe.scope) !== digest(request.scope) || probe.model !== resolved.model.model ||
        probe.contextDigest !== contextIdentity(before)) throw new Error('INVALID_COLLECTOR_RESULT');
      const after = parse(contextSchema, await bounded(() => collector.observeContext(controller.signal)));
      if (!matches(after) || contextIdentity(before) !== contextIdentity(after)) reason = 'CONTEXT_CHANGED';
      else {
        authentication = after.authentication;
        available = probe.availability;
        expiry = Math.min(expiry, Date.parse(before.expiresAt), Date.parse(after.expiresAt));
        reference = probe.evidenceReference;
        verified = authenticated(authentication) && usable(available) && probe.checks.length === checks.length &&
          checks.every(required => probe.checks.some(c => c.id === required && c.passed));
        reason = authentication === 'AUTH_REQUIRED' || available === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED'
          : !authenticated(authentication) ? 'CONTEXT_UNVERIFIED' : verified ? 'CHECKS_PASSED' : 'CHECKS_FAILED';
      }
    }
  } catch (error) {
    reason = aborted ?? (error instanceof Error && error.message === 'INVALID_COLLECTOR_RESULT' ? 'INVALID_COLLECTOR_RESULT' : 'COLLECTOR_FAILED');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  // Never fabricate a future observation timestamp to beat the pending record.
  if (Date.now() === started) await new Promise(resolve => setTimeout(resolve, 1));
  const finished = Date.now();
  if (finished < started) throw new Error('VERIFICATION_CLOCK_CHANGED');
  if (aborted || finished >= started + request.timeoutMs || finished >= expiry) {
    verified = false; reason = aborted ?? 'TIMEOUT'; available = 'TIMEOUT'; authentication = 'UNKNOWN';
  }
  const observation = store.recordResourceObservation({ scope: request.scope, resourceRevision: snapshot.revision,
    authentication, availability: available, verification: verified ? 'VERIFIED' : 'UNAVAILABLE',
    observedAt: new Date(finished).toISOString(),
    expiresAt: new Date(verified ? expiry : finished + Math.min(request.ttlMs, 60000)).toISOString(),
    evidence: { method, reference },
  }, digest(pending));
  return { status: verified ? 'VERIFIED' : 'UNAVAILABLE', reason, observation };
}
