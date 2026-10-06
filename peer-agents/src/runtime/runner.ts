import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runCapture } from '../process.js';
import { redact } from '../security.js';
import type { AgentAdapter, Choice, Mode, TaskState } from './contracts.js';
import { contextPackage } from './context.js';
import { digest } from './identity.js';
import { exportPatch, fingerprint, integratePatch, prepareWorktree, repositoryRoot, repositoryIdentity } from './repository.js';
import { selectAgent } from './scheduler.js';
import { TaskStore } from './store.js';
import { ApprovalVerifier } from './approval.js';

export type RuntimePolicy = {
  policyVersion: string; manifestDigest: string; mode: Mode; competence: number;
  complexity: 'low' | 'medium' | 'high'; testCommand: string[];
  exact?: { agent: string; model: string; effort: string };
  optionalIntegrations?: Record<string, boolean>;
};
export class Runtime {
  constructor(private store: TaskStore, private adapters: AgentAdapter[], private policy: RuntimePolicy,
    private approvalAuthority?: ApprovalVerifier) {
    if (new Set(adapters.map(a => a.id)).size !== adapters.length) throw new Error('Duplicate adapter identity');
    if (!policy.testCommand.length) throw new Error('Observed verification command is required');
  }
  private async environment() {
    const results = await Promise.all(this.adapters.map(async adapter => {
      try { return { id: adapter.id, ...await adapter.discover() }; }
      catch { return { id: adapter.id, choices: [] as Choice[], observation: { component: adapter.id, presence: 'DISCOVERED', authentication: 'UNKNOWN', verification: 'UNAVAILABLE' } }; }
    }));
    const choices = results.flatMap(r => r.choices);
    // Observation clocks change on every discovery; capabilities/auth/version do not.
    const snapshot = results.map(r => ({ id: r.id, choices: r.choices, observation: { ...r.observation, observedAt: undefined } }));
    return { choices, digest: digest(snapshot) };
  }
  private append(state: TaskState, type: string, payload: unknown): TaskState {
    return this.store.append(state.id, state.revision, type, payload);
  }
  private async leased<T>(state: TaskState, action: () => Promise<T>): Promise<T> {
    const owner = randomUUID();
    const repoLease = 'repo:' + (await repositoryIdentity(state.repository)).repositoryKey;
    this.store.acquire(repoLease, owner);
    try {
      this.store.acquire('task:' + state.id, owner);
      try { return await action(); } finally { this.store.release('task:' + state.id, owner); }
    } finally { this.store.release(repoLease, owner); }
  }
  private async observedTest(state: TaskState, phase: string): Promise<TaskState> {
    const [command, ...args] = this.policy.testCommand;
    const before = await fingerprint(state.worktree!);
    const result = await runCapture(command, args, { cwd: state.worktree, timeoutSeconds: 120 }).catch(() => ({
      code: null, stdout: '', stderr: 'Verification executable could not start; raw diagnostics withheld',
      timedOut: false, cancelled: false, stdoutTruncated: false, stderrTruncated: false,
    }));
    const after = await fingerprint(state.worktree!);
    const evidence = this.store.evidence({ text: redact(JSON.stringify(result)), classification: 'PROJECT',
      source: 'runtime-test:' + phase, version: after });
    const next = this.append(state, 'TEST_RECORDED', {
      phase, passed: before === after && result.code === 0 && !result.timedOut && !result.cancelled && !result.stdoutTruncated && !result.stderrTruncated,
      command: this.policy.testCommand, evidence,
    });
    if (!next.tests.at(-1)!.passed) {
      this.append(next, 'TASK_BLOCKED', { reason: before !== after
        ? 'Observed verification changed exportable repository content; reconcile preserved worktree'
        : 'Observed verification failed; reconcile preserved worktree before another task' });
      throw new Error('Observed verification failed; task cannot integrate');
    }
    return next;
  }
  private package(state: TaskState, choice: Choice, role: string, evidence: { id: string; text: string; mandatory: boolean }[] = []) {
    const window = choice.contextWindow;
    return contextPackage({
      task: { ...state }, role, question: state.objective,
      constraints: ['Do not publish, commit, access credentials or delegate to other agents.', 'Work only in the assigned repository.', 'Reviewers must not change files.'],
      evidence, events: this.store.events(state.id).map(e => ({ ...e })),
      policyVersion: this.policy.policyVersion, fingerprint: state.baseline, graphVersion: null,
      allocation: { window, occupied: 0, host: Math.ceil(window * .05), output: Math.ceil(window * .1),
        tools: Math.ceil(window * .15), margin: Math.ceil(window * .05),
        ceiling: Math.floor(window * (this.policy.mode === 'FAST' ? .35 : .55)), remaining: window },
    });
  }
  async start(directory: string, objective: string, checkpointOnly = false): Promise<TaskState> {
    const state = await this.create(directory, objective);
    return this.dispatch(state.id, checkpointOnly);
  }
  async create(directory: string, objective: string): Promise<TaskState> {
    const repository = await repositoryRoot(directory);
    const environment = await this.environment();
    return this.store.create({ objective, repository, baseline: await fingerprint(repository),
      manifestDigest: this.policy.manifestDigest, environmentDigest: environment.digest });
  }
  async dispatch(id: string, checkpointOnly = false): Promise<TaskState> {
    let state = this.store.get(id);
    if (state.status !== 'CREATED') throw new Error('Task already dispatched; use resume');
    const repository = state.repository;
    const environment = await this.environment();
    if (environment.digest !== state.environmentDigest || await fingerprint(repository) !== state.baseline) throw new Error('Environment or repository changed before dispatch');
    const choice = selectAgent(environment.choices, { role: 'lead', competence: this.policy.competence,
      complexity: this.policy.complexity, requiredContext: 2048, exact: this.policy.exact });
    await this.leased(state, async () => {
      state = this.append(state, 'ASSIGNED', choice);
      const isolated = await prepareWorktree(repository);
      state = this.append(state, 'WORKTREE_CREATED', isolated);
      const context = this.package(state, choice, 'lead');
      state = this.append(state, 'CONTEXT_PACKAGED', { hash: context.hash, kind: context.kind, evidence: [] });
      const result = await this.adapters.find(a => a.id === choice.agent)!.execute({
        id: randomUUID(), taskId: state.id, cwd: isolated.path, role: 'lead', choice, prompt: JSON.stringify(context),
      });
      if (result.availability !== 'AVAILABLE') {
        state = this.append(state, 'TASK_BLOCKED', { reason: 'Lead unavailable: ' + result.availability + '; reconcile preserved worktree before reassignment' });
        return;
      }
      const evidence = this.store.evidence({ text: redact(result.response), classification: 'PROJECT', source: 'agent-report:' + choice.agent, version: await fingerprint(isolated.path) });
      state = this.append(state, 'LEAD_FINISHED', { evidence });
      state = await this.observedTest(state, 'lead-verification');
      let reviewer: Choice | undefined;
      try { reviewer = selectAgent(environment.choices, { role: 'reviewer', competence: this.policy.competence,
        complexity: this.policy.complexity, requiredContext: 2048, excluded: [choice.agent] }); } catch { /* single-agent is first-class */ }
      if (reviewer) {
        const reviewPatch = await exportPatch(repository, isolated.path, isolated.baseSha);
        const reviewContext = this.package(state, reviewer, 'reviewer', [{
          id: reviewPatch.hash, text: await readFile(reviewPatch.path, 'utf8'), mandatory: true,
        }]);
        const beforeReview = await fingerprint(isolated.path);
        const review = await this.adapters.find(a => a.id === reviewer!.agent)!.execute({
          id: randomUUID(), taskId: state.id, cwd: isolated.path, role: 'reviewer', choice: reviewer,
          prompt: JSON.stringify(reviewContext),
        });
        if (await fingerprint(isolated.path) !== beforeReview) throw new Error('Reviewer modified repository; integration blocked');
        state = this.append(state, 'REVIEW_RECORDED', review.availability === 'AVAILABLE' && review.review
          ? { agent: reviewer.agent, ...review.review }
          : { agent: reviewer.agent, outcome: 'UNAVAILABLE', findings: [], reason: review.availability });
      } else state = this.append(state, 'REVIEW_RECORDED', { outcome: 'UNAVAILABLE', findings: [], reason: 'No independent eligible agent installed' });
      if (state.reviews.some(r => r.outcome === 'BLOCKED' || r.outcome === 'REQUEST_CHANGES')) {
        state = this.append(state, 'TASK_BLOCKED', { reason: 'Unresolved material review findings' }); return;
      }
      if (!state.reviews.some(r => r.outcome === 'APPROVE')) state = await this.observedTest(state, 'compensating-verification');
      state = this.append(state, 'CHECKPOINT_SAVED', {
        cursor: state.revision, fingerprint: await fingerprint(isolated.path), policyVersion: digest(this.policy),
        packageHash: context.hash, contextVersion: 1,
        ...(result.session ? { session: result.session } : {}),
      });
    });
    const persisted = this.store.get(state.id);
    return checkpointOnly || persisted.status === 'BLOCKED' ? persisted : this.resume(state.id);
  }
  async resume(id: string): Promise<TaskState> {
    let state = this.store.get(id);
    if (state.status === 'COMPLETE' || state.status === 'READY') return state;
    if (state.status !== 'CHECKPOINTED' || !state.checkpoint || !state.worktree || !state.baseSha) {
      throw new Error('Interrupted execution requires artifact/process reconciliation; refusing duplicate dispatch');
    }
    return this.leased(state, async () => {
      // Export does not dispatch an agent. Recheck source/policy, not a provider's changing quota/auth clocks.
      if (state.manifestDigest !== this.policy.manifestDigest) throw new Error('Manifest changed; revalidation required');
      if (state.checkpoint!.policyVersion !== digest(this.policy) || state.checkpoint!.fingerprint !== await fingerprint(state.worktree!)) throw new Error('Checkpoint invalid; source or policy changed');
      if (state.baseline !== await fingerprint(state.repository)) throw new Error('Repository baseline drift');
      const patch = await exportPatch(state.repository, state.worktree!, state.baseSha!);
      state = this.append(state, 'PATCH_EXPORTED', patch);
      return state;
    });
  }
  operationRequest(id: string) {
    const state = this.store.get(id);
    if (state.status !== 'READY' || !state.patch || state.integration) throw new Error('No integration ready; interrupted operations require reconciliation');
    return { schemaVersion: 1, operation: 'integrate', taskId: id, repository: state.repository,
      revision: state.revision, baseline: state.baseline, patchHash: state.patch.hash,
      policyDigest: digest(this.policy), manifestDigest: state.manifestDigest, environmentDigest: state.environmentDigest };
  }
  operationDigest(id: string): string {
    return digest(this.operationRequest(id));
  }
  /** Host-owned human gate; deliberately absent from the MCP surface. */
  async integrate(id: string, receipt: unknown): Promise<TaskState> {
    if (!this.approvalAuthority) throw new Error('No trusted host approval authority configured; integration disabled');
    let state = this.store.get(id);
    return this.leased(state, async () => {
      state = this.store.get(id);
      const operation = this.operationDigest(id);
      if (state.tests.some(t => !t.passed) || !state.tests.length || state.reviews.some(r => ['BLOCKED', 'REQUEST_CHANGES'].includes(r.outcome))) throw new Error('Unresolved engineering gates');
      if (state.checkpoint?.policyVersion !== digest(this.policy) || state.manifestDigest !== this.policy.manifestDigest) throw new Error('Execution policy changed; integration requires revalidation');
      const approval = this.approvalAuthority!.verify(receipt, operation);
      // This event consumes the unique receipt and fences the task atomically before
      // Git can mutate files. A crash cannot make the receipt eligible for replay.
      state = this.append(state, 'INTEGRATION_STARTED', approval);
      await integratePatch(state.repository, state.baseline, state.patch!);
      state = this.append(state, 'INTEGRATED', { operationDigest: operation });
      state = this.append(state, 'TASK_COMPLETED', {});
      return state;
    });
  }
  report(id: string) {
    const state = this.store.get(id);
    return {
      id, status: state.status, tests: state.tests,
      independentReview: state.reviews.some(r => r.agent !== state.assignment?.agent && r.outcome === 'APPROVE'),
      reviews: state.reviews, degraded: state.degraded,
      humanDecisions: state.integration ? [state.integration] : [],
      limitations: [
        'Local execution evidence is not adapter/platform release certification.',
        'Optional intelligence connectors and learned routing are not used by this baseline.',
        ...(!state.reviews.some(r => r.outcome === 'APPROVE') ? ['No independent review; compensating tests are not consensus.'] : []),
        'Worktrees and patches are retained for reconciliation; no destructive cleanup.',
      ],
    };
  }
}
