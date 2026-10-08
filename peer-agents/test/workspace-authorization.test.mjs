import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, rename, symlink, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as policy from '../dist/path-policy.js';

async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), 'peer-workspace-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const a = path.join(base, 'a'), b = path.join(base, 'b');
  for (const repo of [a, b]) {
    await mkdir(repo); execFileSync('git', ['init', '-q', repo]);
  }
  await mkdir(path.join(a, 'src'));
  return { base, a, b, registryFile: path.join(base, 'control', 'environment.sqlite') };
}

test('AUTO_ACTIVE trusts only the host repository and descendants without static registration', async t => {
  assert.equal(typeof policy.WorkspaceAuthorizer, 'function', 'shared workspace authorizer must exist');
  const f = await fixture(t);
  const authorizer = new policy.WorkspaceAuthorizer({ serverCwd: f.a, allowedRoots: [], registryFile: f.registryFile });
  for (const cwd of [f.a, path.join(f.a, 'src')]) {
    const result = await authorizer.check(cwd);
    assert.equal(result.ready, true); assert.equal(result.authorizationMode, 'ACTIVE_WORKSPACE');
  }
  assert.equal((await authorizer.check(f.b)).reason, 'NOT_ENROLLED');
  const next = new policy.WorkspaceAuthorizer({ serverCwd: f.b, allowedRoots: [], registryFile: f.registryFile });
  assert.equal((await next.check(f.b)).authorizationMode, 'ACTIVE_WORKSPACE');
  const activeB = await authorizer.check(f.b, 'REVIEW', [f.b]);
  assert.equal(activeB.authorizationMode, 'ACTIVE_WORKSPACE');
  assert.equal((await authorizer.check(f.a, 'REVIEW', [f.b])).ready, false, 'host roots replace startup scope');
  assert.equal((await authorizer.check(f.a, 'REVIEW', [])).ready, false, 'empty host roots revoke startup scope');
});

test('legacy roots remain strict; AUTO_ACTIVE explicitly adds host eligibility', async t => {
  assert.equal(typeof policy.WorkspaceAuthorizer, 'function');
  const f = await fixture(t);
  const strict = new policy.WorkspaceAuthorizer({ serverCwd: f.a, allowedRoots: [f.b], registryFile: f.registryFile });
  assert.equal((await strict.check(f.a)).ready, false);
  assert.equal((await strict.check(f.b)).authorizationMode, 'EXPLICIT_ROOT');
  const auto = new policy.WorkspaceAuthorizer({ serverCwd: f.a, allowedRoots: [f.b], mode: 'AUTO_ACTIVE', registryFile: f.registryFile });
  assert.equal((await auto.check(f.a)).authorizationMode, 'ACTIVE_WORKSPACE');
  assert.equal((await auto.check(f.b)).authorizationMode, 'EXPLICIT_ROOT');
  assert.equal((await auto.check(f.a, 'DEPLOY')).ready, false);
});

test('dynamic enrollment is visible to the same authorizer and removal revokes it', async t => {
  assert.equal(typeof policy.WorkspaceAuthorizer, 'function');
  const f = await fixture(t);
  const authorizer = new policy.WorkspaceAuthorizer({ serverCwd: f.a, allowedRoots: [], registryFile: f.registryFile });
  assert.equal((await authorizer.check(f.b)).ready, false);
  await authorizer.enroll(f.b);
  assert.equal((await authorizer.check(f.b)).authorizationMode, 'ENROLLED');
  const strict = new policy.WorkspaceAuthorizer({ serverCwd: f.a, allowedRoots: [f.a], registryFile: f.registryFile });
  assert.equal((await strict.check(f.b)).ready, false, 'strict roots cannot be bypassed by enrollment');
  authorizer.remove(f.b);
  assert.equal((await authorizer.check(f.b)).ready, false);
});

test('sensitive roots and physical escapes override every grant', async t => {
  assert.equal(typeof policy.WorkspaceAuthorizer, 'function');
  const f = await fixture(t);
  const authorizer = new policy.WorkspaceAuthorizer({ serverCwd: f.a, allowedRoots: [f.base], mode: 'AUTO_ACTIVE', deniedRoots: [f.b], registryFile: f.registryFile });
  assert.equal((await authorizer.check(f.b, 'REVIEW', [f.b])).reason, 'SENSITIVE_PATH');
  await assert.rejects(authorizer.enroll(f.b), /sensitive/i);
  const link = path.join(f.a, 'escape');
  await symlink(f.b, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await authorizer.check(link)).ready, false);
  await mkdir(path.join(f.a, '.codex'));
  assert.equal((await authorizer.check(path.join(f.a, '.codex'))).ready, true, 'project-local config is not a global store');
});

test('enrolled and active identities fail closed after root replacement', async t => {
  assert.equal(typeof policy.WorkspaceAuthorizer, 'function');
  const f = await fixture(t);
  const authorizer = new policy.WorkspaceAuthorizer({ serverCwd: f.a, allowedRoots: [], registryFile: f.registryFile });
  await authorizer.enroll(f.b);
  assert.equal((await authorizer.check(f.a)).ready, true);
  await rename(f.b, path.join(f.base, 'old-b'));
  await symlink(f.a, f.b, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await authorizer.check(f.b)).ready, false, 'replaced enrollment cannot borrow active grant');
  await rm(f.b); await mkdir(f.b); execFileSync('git', ['init', '-q', f.b]);
  assert.equal((await authorizer.check(f.b)).ready, false, 'new object at enrolled name needs explicit reconciliation');
  await rename(f.a, path.join(f.base, 'old-a'));
  await symlink(f.b, f.a, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await authorizer.check(f.a)).ready, false);
});

test('registry rejects redirected state and unsupported versions without authorizing', async t => {
  const f = await fixture(t);
  const authorizer = new policy.WorkspaceAuthorizer({ serverCwd: f.a, allowedRoots: [], registryFile: f.registryFile });
  await authorizer.enroll(f.b);
  const db = new DatabaseSync(f.registryFile);
  db.exec('UPDATE workspace_registry_meta SET version=99'); db.close();
  assert.equal((await authorizer.check(f.a)).ready, false);
  await assert.rejects(authorizer.enroll(f.b));
  await rename(path.dirname(f.registryFile), path.join(f.base, 'old-control'));
  await symlink(path.join(f.base, 'old-control'), path.dirname(f.registryFile), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await authorizer.check(f.a)).ready, false);
});

test('native ancestor aliases do not prevent registry use and active descendants are bounded', async t => {
  const f = await fixture(t);
  const alias = path.join(f.base, 'alias');
  await symlink(f.base, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const authorizer = new policy.WorkspaceAuthorizer({ serverCwd: f.a, allowedRoots: [], registryFile: path.join(alias, 'control', 'environment.sqlite') });
  await authorizer.enroll(f.b);
  assert.equal((await authorizer.check(f.b)).ready, true);
  assert.equal((await authorizer.check(path.join(f.a, 'src'), 'REVIEW', [path.join(f.a, 'src')])).ready, true);
  assert.equal((await authorizer.check(f.a, 'REVIEW', [path.join(f.a, 'src')])).ready, false, 'host subdirectory must not grant its parent');
});

test('removing enrollment through its original alias actually revokes that enrollment', async t => {
  const f = await fixture(t);
  const alias = path.join(f.base, 'project-alias');
  await symlink(f.b, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const authorizer = new policy.WorkspaceAuthorizer({ serverCwd: f.a, allowedRoots: [], registryFile: f.registryFile });
  await authorizer.enroll(alias);
  authorizer.remove(alias);
  assert.equal((await authorizer.check(f.b)).ready, false);
  await authorizer.enroll(alias);
  await rm(alias); // Removal also works after the alias itself has disappeared.
  authorizer.remove(alias);
  assert.equal((await authorizer.check(f.b)).ready, false);
  await symlink(f.b, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await authorizer.enroll(alias);
  await rm(alias); await symlink(f.a, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await authorizer.check(alias)).ready, false, 'redirected enrollment cannot borrow another active grant');
  authorizer.remove(alias);
  assert.equal((await authorizer.check(f.b)).ready, false);
  await rm(alias); await symlink(f.b, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await authorizer.enroll(f.b);
  authorizer.remove(alias); // A different, currently valid alias uses the same identity.
  assert.equal((await authorizer.check(f.b)).ready, false);
});

test('switching active projects does not keep obsolete roots as global denial dependencies', async t => {
  const f = await fixture(t);
  const authorizer = new policy.WorkspaceAuthorizer({ serverCwd: f.a, allowedRoots: [], registryFile: f.registryFile });
  assert.equal((await authorizer.check(f.a, 'REVIEW', [f.a])).ready, true);
  assert.equal((await authorizer.check(f.b, 'REVIEW', [f.b])).ready, true);
  await rename(f.a, path.join(f.base, 'old-a'));
  assert.equal((await authorizer.check(f.b, 'REVIEW', [f.b])).ready, true);
  await symlink(f.b, f.a, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await authorizer.check(f.a, 'REVIEW', [f.a])).ready, false, 'returning to a replaced historical root still fails');
});

test('enrollment never adopts or mutates an unknown existing control database', async t => {
  const f = await fixture(t);
  await mkdir(path.dirname(f.registryFile));
  const db = new DatabaseSync(f.registryFile); db.exec('CREATE TABLE unrelated(value TEXT)'); db.close();
  const before = await readFile(f.registryFile);
  const authorizer = new policy.WorkspaceAuthorizer({ serverCwd: f.a, allowedRoots: [], registryFile: f.registryFile });
  await assert.rejects(authorizer.enroll(f.b));
  assert.deepEqual(await readFile(f.registryFile), before);
});
