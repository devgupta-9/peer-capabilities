import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { Runtime } from '../../dist/runtime/runner.js';
import { TaskStore } from '../../dist/runtime/store.js';
import { stateDirectory } from '../../dist/runtime/repository.js';
import { ApprovalVerifier } from '../../dist/runtime/approval.js';
import { fixtureAuthority } from './approval.mjs';

const [root, single, disabled, command, id] = process.argv.slice(2);
function adapter(name, quota = false) {
  return {
    id: name, loginInstructions: () => 'Not required for deterministic fixture',
    discover: async () => ({
      observation: { component: name, presence: 'CONFIGURED', authentication: 'NOT_REQUIRED', verification: 'VERIFIED', observedAt: 'fixture' },
      choices: [{ agent: name, model: name + '-exact', effort: 'high', efforts: ['high'], roles: ['lead', 'reviewer'],
        competence: name === 'lead' ? 10 : 9, cost: name === 'lead' ? 1 : 2, latency: 1, contextWindow: 100000,
        availability: 'AVAILABLE', authentication: 'NOT_REQUIRED', provider: name, quotaPool: name }],
    }),
    execute: async invocation => {
      if (quota) return { availability: 'QUOTA_EXHAUSTED', response: '' };
      if (invocation.role === 'lead') await writeFile(path.join(invocation.cwd, 'answer.txt'), '42\n');
      return { availability: 'AVAILABLE', response: 'fixture completed', review: { outcome: 'APPROVE', findings: [] } };
    },
  };
}
const store = new TaskStore(path.join(await stateDirectory(root), 'tasks.sqlite'));
const adapters = single === 'true' ? [adapter('lead')] : [adapter('lead'), adapter('reviewer', true)];
const authority = fixtureAuthority();
const runtime = new Runtime(store, adapters, {
  policyVersion: 'fixture-v1', manifestDigest: 'fixture-manifest', mode: 'STANDARD',
  competence: 8, complexity: 'high', optionalIntegrations: Object.fromEntries(['graphify', 'headroom', 'jev'].map(k => [k, !disabled.split(',').includes(k)])),
  testCommand: [process.execPath, '-e', "if(require('node:fs').readFileSync('answer.txt','utf8')!=='42\\n')process.exit(1)"],
}, new ApprovalVerifier('fixture-host', authority.publicKey));
try {
  if (command === 'start') console.log(JSON.stringify(await runtime.start(root, 'Make answer exactly 42', true)));
  if (command === 'resume') console.log(JSON.stringify(await runtime.resume(id)));
  if (command === 'integrate') {
    const state = await runtime.integrate(id, authority.grant(runtime.operationDigest(id)));
    console.log(JSON.stringify({ ...state, report: runtime.report(id) }));
  }
} finally { store.close(); }
