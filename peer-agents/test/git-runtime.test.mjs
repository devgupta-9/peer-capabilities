import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCapture } from '../dist/process.js';
const load = () => import('../dist/runtime/repository.js');
test('fingerprinting streams large file contents when whole-file allocation is unavailable', async () => {
  const { fingerprint } = await load();
  const root = await fixture(), full = path.join(root, 'large.bin');
  const original = fs.promises.readFile;
  try {
    await writeFile(full, Buffer.alloc(4 * 1024 * 1024, 97));
    fs.promises.readFile = async (file, ...args) => {
      if (path.resolve(String(file)) === full) throw new Error('Whole-file allocation unavailable for large fixture');
      return original(file, ...args);
    };
    syncBuiltinESMExports();
    let first;
    await assert.doesNotReject(async () => { first = await fingerprint(root); });
    await appendFile(full, 'b');
    assert.notEqual(await fingerprint(root), first);
  } finally {
    fs.promises.readFile = original; syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
  }
});
export const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'peer-git-'));
  git(root, 'init'); git(root, 'config', 'user.email', 'test@example.invalid'); git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'core.autocrlf', 'false');
  await writeFile(path.join(root, 'answer.txt'), 'wrong\n'); git(root, 'add', '.'); git(root, 'commit', '-m', 'fixture');
  return root;
}
test('fingerprints notice contents changing without porcelain status changing', async () => {
  const api = await load().catch(() => ({}));
  assert.equal(typeof api.fingerprint, 'function');
  const root = await fixture();
  try {
    await writeFile(path.join(root, 'answer.txt'), 'dirty one\n');
    const first = await api.fingerprint(root);
    await writeFile(path.join(root, 'answer.txt'), 'dirty two\n');
    assert.notEqual(await api.fingerprint(root), first);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('verified original-base patch rejects baseline drift and leaves both trees intact', async () => {
  const { fingerprint, prepareWorktree, exportPatch, integratePatch } = await load();
  const root = await fixture();
  try {
    const baseline = await fingerprint(root);
    const isolated = await prepareWorktree(root);
    await writeFile(path.join(isolated.path, 'answer.txt'), '42\n');
    git(isolated.path, 'add', '.'); git(isolated.path, 'commit', '-m', 'agent commit');
    const patch = await exportPatch(root, isolated.path, isolated.baseSha);
    await writeFile(path.join(root, 'user.txt'), 'unrelated new work');
    await assert.rejects(integratePatch(root, baseline, patch), /baseline/i);
    assert.equal(await readFile(path.join(root, 'answer.txt'), 'utf8'), 'wrong\n');
    assert.equal(await readFile(path.join(isolated.path, 'answer.txt'), 'utf8'), '42\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('integration applies exactly the approved bytes even if the patch path changes after verification', async () => {
  const { fingerprint, prepareWorktree, exportPatch, integratePatch } = await load();
  const root = await fixture();
  try {
    const baseline = await fingerprint(root);
    const isolated = await prepareWorktree(root);
    await writeFile(path.join(isolated.path, 'answer.txt'), '42\n');
    const patch = await exportPatch(root, isolated.path, isolated.baseSha);
    const capture = async (command, args, options) => {
      const result = await runCapture(command, args, options);
      if (args.includes('--check')) {
        const text = await readFile(patch.path, 'utf8');
        assert.ok(text.includes('+42'));
        await writeFile(patch.path, text.replace('+42', '+99'));
      }
      return result;
    };
    await integratePatch(root, baseline, patch, capture);
    assert.equal(await readFile(path.join(root, 'answer.txt'), 'utf8'), '42\n');
    assert.match(await readFile(patch.path, 'utf8'), /\+99/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
