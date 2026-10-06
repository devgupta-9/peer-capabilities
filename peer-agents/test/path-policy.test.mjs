import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, symlink, rename } from 'node:fs/promises';
import { directoryIdentity } from '../dist/filesystem-identity.js';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { authorizeWorkingDirectory } from '../dist/path-policy.js';

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

async function initRepository(root) {
  await mkdir(root, { recursive: true });
  execFileSync('git', ['init', root]);
  git(root, 'config', 'user.email', 'peer-agents@example.invalid');
  git(root, 'config', 'user.name', 'peer-agents test');
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-m', 'base');
}

test('delegation accepts only Git workspaces inside configured roots', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'peer-agents-path-'));
  try {
    const allowedParent = path.join(fixture, 'allowed');
    const allowedRepo = path.join(allowedParent, 'repo');
    const deniedRepo = path.join(fixture, 'denied', 'repo');
    const nonRepo = path.join(allowedParent, 'plain');
    await initRepository(allowedRepo);
    await initRepository(deniedRepo);
    await mkdir(nonRepo, { recursive: true });

    const accepted = await authorizeWorkingDirectory(allowedRepo, {
      allowedRoots: [allowedParent],
      serverCwd: allowedRepo,
    });
    assert.equal(directoryIdentity(accepted.gitRoot).key, directoryIdentity(allowedRepo).key);
    const redirect = path.join(allowedParent, 'redirect');
    await symlink(deniedRepo, redirect, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(authorizeWorkingDirectory(redirect, { allowedRoots: [allowedParent] }), /outside configured/);

    await assert.rejects(
      authorizeWorkingDirectory(deniedRepo, { allowedRoots: [allowedParent], serverCwd: allowedRepo }),
      /outside configured delegation roots/i,
    );
    await assert.rejects(
      authorizeWorkingDirectory(nonRepo, { allowedRoots: [allowedParent], serverCwd: allowedRepo }),
      /Git repository/i,
    );
    await rename(allowedParent, path.join(fixture, 'old-allowed'));
    await symlink(path.join(fixture, 'denied'), allowedParent, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(authorizeWorkingDirectory(path.join(allowedParent, 'repo'), { allowedRoots: [allowedParent] }), /scope|identity/i);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('delegation fails closed when neither explicit roots nor a server Git root exist', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'peer-agents-path-no-root-'));
  try {
    const repo = path.join(fixture, 'repo');
    const serverCwd = path.join(fixture, 'server');
    await initRepository(repo);
    await mkdir(serverCwd, { recursive: true });
    await assert.rejects(
      authorizeWorkingDirectory(repo, { allowedRoots: [], serverCwd }),
      /PEER_AGENTS_ALLOWED_ROOTS/i,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
