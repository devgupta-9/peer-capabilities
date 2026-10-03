import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { finalizeImplementationWorktree } from '../dist/worktree.js';

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

async function repositoryFixture() {
  const fixture = await mkdtemp(path.join(tmpdir(), 'peer-agents-worktree-'));
  const root = path.join(fixture, 'root');
  const worktree = path.join(fixture, 'worktree');
  const runs = path.join(fixture, 'runs');
  await writeFile(path.join(fixture, '.keep'), 'fixture');
  execFileSync('git', ['init', root]);
  git(root, 'config', 'user.email', 'peer-agents@example.invalid');
  git(root, 'config', 'user.name', 'peer-agents test');
  await writeFile(path.join(root, 'large.txt'), 'base\n', 'utf8');
  git(root, 'add', '-A');
  git(root, 'commit', '-m', 'base');
  git(root, 'worktree', 'add', '--detach', worktree, 'HEAD');
  return { fixture, root, worktree, runs };
}

test('IMPLEMENT exports a complete verified patch before removing its worktree', async () => {
  const f = await repositoryFixture();
  try {
    const unicode = 'বাংলা🙂'.repeat(70_000);
    await writeFile(path.join(f.worktree, 'large.txt'), `${unicode}\n`, 'utf8');
    await writeFile(path.join(f.worktree, 'binary.bin'), Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256)));

    const result = await finalizeImplementationWorktree({
      root: f.root,
      worktree: f.worktree,
      runId: 'large-unicode-binary',
      target: 'codex',
      runDirectory: f.runs,
    });

    assert.equal(result.verified, true);
    assert.ok(result.patchPath);
    assert.ok(result.patchBytes > 262_144);
    assert.equal((await stat(result.patchPath)).size, result.patchBytes);
    assert.match(await readFile(result.patchPath, 'utf8'), /বাংলা/);
    assert.doesNotThrow(() => git(f.root, 'apply', '--check', '--binary', result.patchPath));
    await assert.rejects(stat(f.worktree));
  } finally {
    await rm(f.fixture, { recursive: true, force: true });
  }
});

test('IMPLEMENT preserves delegated work when patch verification fails', async () => {
  const f = await repositoryFixture();
  try {
    await writeFile(path.join(f.worktree, 'large.txt'), 'delegated change\n', 'utf8');
    await writeFile(path.join(f.root, 'large.txt'), 'conflicting primary change\n', 'utf8');

    await assert.rejects(
      finalizeImplementationWorktree({
        root: f.root,
        worktree: f.worktree,
        runId: 'verification-failure',
        target: 'antigravity',
        runDirectory: f.runs,
      }),
      (error) => {
        assert.match(error.message, /failed git apply --check/i);
        assert.match(error.message, /worktree preserved/i);
        return true;
      },
    );

    assert.equal((await readFile(path.join(f.worktree, 'large.txt'), 'utf8')), 'delegated change\n');
    assert.equal((await stat(`${path.join(f.runs, 'verification-failure-antigravity.patch')}.partial`)).size > 0, true);
  } finally {
    git(f.root, 'reset', '--hard', 'HEAD');
    git(f.root, 'worktree', 'remove', '--force', f.worktree);
    await rm(f.fixture, { recursive: true, force: true });
  }
});

test('IMPLEMENT includes delegate commits relative to the original base', async () => {
  const f = await repositoryFixture();
  try {
    const baseSha = git(f.root, 'rev-parse', 'HEAD').trim();
    await writeFile(path.join(f.worktree, 'large.txt'), 'committed by delegate\n');
    git(f.worktree, 'add', '-A');
    git(f.worktree, 'commit', '-m', 'delegate commit');
    const result = await finalizeImplementationWorktree({
      ...f, runId: 'committed', target: 'codex', runDirectory: f.runs, baseSha,
    });
    assert.ok(result.patchPath, 'a delegate commit must not be mistaken for no changes');
    git(f.root, 'apply', result.patchPath);
    assert.match(await readFile(path.join(f.root, 'large.txt'), 'utf8'), /committed by delegate/);
  } finally {
    await rm(f.fixture, { recursive: true, force: true });
  }
});
