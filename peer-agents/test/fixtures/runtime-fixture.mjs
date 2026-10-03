import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Runtime } from '../../dist/runtime/runner.js';
import { TaskStore } from '../../dist/runtime/store.js';

export async function runtimeFixture(testScript = 'process.exit(0)', authority) {
  const root = await mkdtemp(path.join(tmpdir(), 'peer-governance-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'core.autocrlf', 'false');
  await writeFile(path.join(root, 'answer.txt'), 'wrong\n'); git('add', '.'); git('commit', '-m', 'base');
  const database = path.join(root, '.git', 'tasks.sqlite');
  const store = new TaskStore(database);
  const policy = { policyVersion: 'fixture', manifestDigest: 'fixture', mode: 'STANDARD', competence: 8,
    complexity: 'high', testCommand: [process.execPath, '-e', testScript] };
  const adapters = [{ id: 'fixture', loginInstructions: () => 'No authentication',
    discover: async () => ({ observation: { component: 'fixture', presence: 'CONFIGURED', authentication: 'NOT_REQUIRED', verification: 'VERIFIED' },
      choices: [{ agent: 'fixture', model: 'fixture', effort: 'high', efforts: ['high'], roles: ['lead'], competence: 10,
        cost: 0, latency: 0, contextWindow: 50000, availability: 'AVAILABLE', authentication: 'NOT_REQUIRED', provider: 'fixture', quotaPool: 'fixture' }] }),
    execute: async input => { await writeFile(path.join(input.cwd, 'answer.txt'), '42\n'); return { availability: 'AVAILABLE', response: 'Fixture edit' }; },
  }];
  const runtime = new Runtime(store, adapters, policy, authority);
  return { root, store, runtime, database, policy, adapters,
    close: async (alreadyClosed = false) => { if (!alreadyClosed) store.close(); await rm(root, { recursive: true, force: true }); } };
}
