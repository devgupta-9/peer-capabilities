import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rename, symlink, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { directoryIdentity, assertIdentity, containsDirectory } from '../dist/filesystem-identity.js';
import { defaultEnvironmentDirectory } from '../dist/runtime/environment-state.js';
import { EnvironmentManager } from '../dist/runtime/environment.js';
import { repositoryIdentity } from '../dist/runtime/repository.js';
import { digest } from '../dist/runtime/identity.js';

test('native aliases share identity and state, without case folding distinct directories', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-identity-'));
  try {
    const root = path.join(dir, 'Real Root'); await mkdir(root);
    const alias = path.join(dir, 'alias'); await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const a = directoryIdentity(root), b = directoryIdentity(alias);
    assert.equal(a.canonicalPath, realpathSync.native(root));
    assert.equal(a.key, b.key); assert.notEqual(a.displayPath, b.displayPath);
    const base = path.join(dir, 'state');
    assert.equal(defaultEnvironmentDirectory(root, base), defaultEnvironmentDirectory(alias, base));
    const manager = new EnvironmentManager(path.join(dir, 'env.sqlite'), alias); manager.close();
    new EnvironmentManager(path.join(dir, 'env.sqlite'), root).close();
    if (process.platform === 'win32') {
      assert.equal(directoryIdentity(root.toUpperCase()).key, a.key);
      assert.equal(directoryIdentity(path.toNamespacedPath(root)).key, a.key);
      const short = execFileSync('cmd.exe', ['/d', '/s', '/c', `for %I in ("${root}") do @echo %~sI`], { encoding: 'utf8', windowsVerbatimArguments: true }).trim();
      assert.equal(directoryIdentity(short).key, a.key);
    } else {
      const other = path.join(dir, 'real root');
      try { await mkdir(other); assert.notEqual(directoryIdentity(other).key, a.key); }
      catch (e) { if (e.code !== 'EEXIST') throw e; } // case-insensitive volumes may alias
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('pinned roots reject replacement by either a directory or redirect', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-pin-'));
  try {
    const root = path.join(dir, 'root'); await mkdir(root);
    const identity = directoryIdentity(root);
    await rename(root, path.join(dir, 'old')); await mkdir(root);
    assert.throws(() => assertIdentity(identity), /scope|identity/i);
    assert.throws(() => containsDirectory(identity, directoryIdentity(root)), /scope|identity/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('legacy alias-derived environment databases are detected without adoption or migration', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-legacy-'));
  try {
    const root = path.join(dir, 'real'); await mkdir(root);
    const alias = path.join(dir, 'alias'); await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const base = path.join(dir, 'states'), legacy = path.join(base, digest(alias)); await mkdir(legacy, { recursive: true });
    const db = new DatabaseSync(path.join(legacy, 'environment.sqlite'));
    db.exec('CREATE TABLE environment_scope(id INTEGER PRIMARY KEY, root TEXT NOT NULL)');
    db.prepare('INSERT INTO environment_scope VALUES(1,?)').run(alias); db.close();
    assert.throws(() => defaultEnvironmentDirectory(root, base), /legacy|conflict/i);
    assert.throws(() => new EnvironmentManager(path.join(legacy, 'environment.sqlite'), root), /scope|legacy/i);
    const untouched = new DatabaseSync(path.join(legacy, 'environment.sqlite'), { readOnly: true });
    try { assert.equal(untouched.prepare("SELECT name FROM sqlite_master WHERE name='environment_identity'").get(), undefined); }
    finally { untouched.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('linked worktrees share repository identity but have distinct checkout identities', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-repo-identity-'));
  try {
    const main = path.join(dir, 'main'), linked = path.join(dir, 'linked'); await mkdir(main);
    const git = (...args) => execFileSync('git', ['-C', main, ...args], { stdio: 'pipe' });
    git('init'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'base');
    git('worktree', 'add', '--detach', linked);
    const a = await repositoryIdentity(main), b = await repositoryIdentity(linked);
    assert.equal(a.repositoryKey, b.repositoryKey);
    assert.notEqual(a.checkoutKey, b.checkoutKey);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
