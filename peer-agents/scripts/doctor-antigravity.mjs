// Explicit, potentially billable model verification. No login, permission changes, or credential copying.
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { callBridge } from './mcp-call.mjs';
import { toolEvidenceHash, toolPathHash, antigravitySandboxMode } from '../dist/antigravity.js';
import { normalizeFailure } from '../dist/runtime/adapters.js';

export function assessDelegation(payload, expected) {
  const evidence = payload.antigravityToolEvidence ?? [];
  const exactSelection = payload.model === expected.model && payload.effort === expected.effort;
  const fileRead = evidence.some(event => event.tool === 'view_file' && event.pathHash === toolPathHash(expected.file));
  const commandRan = evidence.some(event => event.tool === 'run_command' && event.commandHash === toolEvidenceHash('git status --short')
    && event.cwdHash === toolPathHash(expected.cwd));
  const gitRootMatched = typeof expected.gitRoot === 'string' && evidence.some(event => event.tool === 'run_command'
    && event.commandHash === toolEvidenceHash('git rev-parse --show-toplevel')
    && event.cwdHash === toolPathHash(expected.cwd) && event.gitRootHash === toolPathHash(expected.gitRoot));
  const proofReturned = typeof payload.response === 'string' && payload.response.includes(expected.nonce);
  const verified = payload.ok === true && !payload.policyViolation && exactSelection && fileRead && commandRan && gitRootMatched && proofReturned
    && Array.isArray(payload.antigravityToolFailures) && payload.antigravityToolFailures.length === 0;
  const availability = payload.ok === true ? 'AVAILABLE' : normalizeFailure(String(payload.error ?? ''), false);
  return {
    authentication: payload.ok === true ? 'AUTHENTICATED' : availability === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'UNKNOWN',
    verification: verified ? 'VERIFIED' : 'UNAVAILABLE', availability,
    checks: { exactSelection, fileRead, commandRan, gitRootMatched, proofReturned, toolFailures: payload.antigravityToolFailures?.length ?? null },
    nextAction: verified ? 'Re-run after CLI, account, permissions, or workspace changes. This does not certify other tools or machines.'
      : availability === 'AUTH_REQUIRED' ? 'Complete official login in an interactive agy session, then repeat this check.'
      : availability === 'POLICY_BLOCKED' ? 'Review exact command/workspace permissions and the selected sandbox mode. Deny/ask rules take precedence; no automatic bypass.'
      : 'Inspect the provider session for missing tool evidence, quota, sandbox support, or connectivity. No automatic retry or substitution.',
  };
}

function payload(result) {
  const text = result.content?.find(block => block.type === 'text')?.text;
  if (!text) throw new Error('Bridge returned no structured result');
  return JSON.parse(text);
}

export async function doctorAntigravity(options, bridgeCall = callBridge) {
  if (!options.cwd || !path.isAbsolute(options.cwd)) throw new Error('--cwd must be an absolute project directory');
  if (options.verify && (!options.model || !options.effort)) throw new Error('--verify requires an exact --model and --effort');
  const env = {};
  if (options.sandboxMode) env.PEER_AGY_SANDBOX_MODE = antigravitySandboxMode(options.sandboxMode);
  // A fresh bridge launched from the explicitly selected project; does not certify a host's registration.
  const bridge = { cwd: options.cwd, env };
  const discovered = payload(await bridgeCall('peer_capabilities', { cwd: options.cwd }, bridge));
  const report = { component: 'antigravity', observedAt: new Date().toISOString(), platform: process.platform,
    architecture: process.arch, node: process.version, version: discovered.antigravity?.version,
    cwd: discovered.workspace?.cwd, gitRoot: discovered.workspace?.gitRoot, sandboxMode: discovered.antigravity?.sandboxMode,
    presence: discovered.antigravity?.available ? 'INSTALLED' : 'DISCOVERED',
    configured: discovered.workspace?.ready === true, authentication: 'UNKNOWN', verification: 'UNVERIFIED',
    scope: 'Fresh checkout bridge; host registration and other machines not certified',
  };
  if (!options.verify) return report;
  if (!report.configured || report.presence !== 'INSTALLED') return { ...report, verification: 'UNAVAILABLE',
    nextAction: 'Install the official CLI and configure a specific Git project in PEER_AGENTS_ALLOWED_ROOTS.' };
  if (!discovered.antigravity.models?.includes(options.model) || !discovered.antigravity.efforts?.includes(options.effort)) {
    return { ...report, verification: 'UNAVAILABLE', nextAction: 'Check agy models and select an exact supported model/effort. Catalog failure is not proof that a model is invalid.' };
  }
  const fixture = await mkdtemp(path.join(report.cwd, '.peer-readiness-'));
  const file = path.join(fixture, 'proof.txt');
  const nonce = randomUUID();
  try {
    await writeFile(file, nonce + '\n', { flag: 'wx' });
    const result = await bridgeCall('delegate_peer', { caller: 'codex', cwd: report.cwd, mode: 'READ_ONLY',
      model: options.model, effort: options.effort, timeoutSeconds: 180,
      selectionReason: 'Explicit user-requested live readiness verification of this exact model and workspace.',
      task: `Read-only tool readiness test. Do not modify files, use MCPs, inspect credentials, or delegate. Use view_file on the exact absolute path ${JSON.stringify(file)}. Return its proof value. Run exactly git status --short and then exactly git rev-parse --show-toplevel as separate calls in the assigned cwd, without wrappers, git -C, pipelines, or extra flags. Use no other commands. Report denied actions honestly.`,
      deliverable: 'Proof value read from the file, Git status outcome and observed repository root; no changes.',
    }, bridge);
    const assessment = assessDelegation(payload(result), { file, nonce, cwd: report.cwd, gitRoot: report.gitRoot, model: options.model, effort: options.effort });
    return { ...report, ...assessment, model: options.model, effort: options.effort,
      observedAt: new Date().toISOString(), scope: 'Exact model response, fixture read, Git status and observed Git root; existing provider-owned account and permissions only' };
  } finally {
    // Remove only our generated file and empty directory. Never recursively delete provider-created content.
    await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(fixture);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { cwd: { type: 'string' }, model: { type: 'string' },
      effort: { type: 'string' }, verify: { type: 'boolean' }, 'sandbox-mode': { type: 'string' } } });
    const report = await doctorAntigravity({ ...values, sandboxMode: values['sandbox-mode'] });
    console.log(JSON.stringify(report, null, 2));
    if (report.verification === 'UNAVAILABLE' || !report.configured || report.presence !== 'INSTALLED') process.exitCode = 1;
  } catch {
    console.error('Antigravity readiness could not complete. Check arguments, project roots, CLI availability, and provider permissions. Raw diagnostics withheld.');
    process.exitCode = 1;
  }
}
