import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { runCapture } from '../process.js';
import { contentHash, digest } from './identity.js';

async function git(root: string, args: string[], input?: Buffer, execute = runCapture) {
  const r = await execute('git', ['-C', root, ...args], { timeoutSeconds: 60, input });
  if (r.code !== 0 || r.timedOut || r.stdoutTruncated || r.stderrTruncated) throw new Error('Git operation failed or exceeded safe capture limit: ' + args[0]);
  return r.stdout;
}
export async function repositoryRoot(directory: string): Promise<string> {
  const root = await realpath((await git(directory, ['rev-parse', '--show-toplevel'])).trim());
  if (root !== await realpath(directory)) throw new Error('Task directory must be the repository root');
  return root;
}
export async function stateDirectory(root: string): Promise<string> {
  return path.join(path.resolve(root, (await git(root, ['rev-parse', '--git-common-dir'])).trim()), 'peer-capabilities');
}
export async function fingerprint(root: string): Promise<string> {
  const head = (await git(root, ['rev-parse', 'HEAD'])).trim();
  const index = await git(root, ['ls-files', '--stage', '-z']);
  const files = (await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).split('\0').filter(Boolean);
  const entries: [string, string, number][] = [];
  for (const relative of [...new Set(files)].sort()) {
    const full = path.resolve(root, relative);
    if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error('Git path escaped repository');
    try {
      const info = await lstat(full);
      if (info.isSymbolicLink()) entries.push([relative, contentHash(await readlink(full)), info.mode]);
      else if (info.isFile()) {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(full)) hash.update(chunk);
        entries.push([relative, hash.digest('hex'), info.mode]);
      }
      else throw new Error('Unsupported submodule or special file in fingerprint');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') entries.push([relative, 'DELETED', 0]); else throw e;
    }
  }
  return digest({ head, index, entries });
}
export async function prepareWorktree(root: string): Promise<{ path: string; baseSha: string }> {
  if ((await git(root, ['status', '--porcelain=v1', '--untracked-files=all'])).trim()) {
    throw new Error('Initial implementation requires a clean baseline; existing work is preserved, never stashed');
  }
  const baseSha = (await git(root, ['rev-parse', 'HEAD'])).trim();
  const directory = await stateDirectory(root);
  const worktree = path.join(directory, 'worktrees', randomUUID());
  await mkdir(path.dirname(worktree), { recursive: true });
  await git(root, ['worktree', 'add', '--detach', worktree, baseSha]);
  return { path: worktree, baseSha };
}
export async function exportPatch(root: string, worktree: string, baseSha: string) {
  if (!/^[a-f0-9]{40,64}$/i.test(baseSha)) throw new Error('Invalid base SHA');
  await git(worktree, ['add', '-A']);
  const directory = path.join(await stateDirectory(root), 'patches');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, randomUUID() + '.patch');
  await git(worktree, ['diff', '--cached', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', baseSha, '--output=' + file]);
  const bytes = await readFile(file);
  if (!bytes.length) throw new Error('No implementation patch; worktree preserved for inspection');
  await git(root, ['apply', '--check', '--binary', file]);
  return { path: file, hash: contentHash(bytes), bytes: bytes.length };
}
export async function integratePatch(root: string, baseline: string, patch: { path: string; hash: string }, execute = runCapture): Promise<void> {
  if (await fingerprint(root) !== baseline) throw new Error('Repository baseline drift; patch and worktree preserved');
  const bytes = await readFile(patch.path);
  if (contentHash(bytes) !== patch.hash) throw new Error('Patch integrity mismatch');
  await git(root, ['apply', '--check', '--binary', '-'], bytes, execute);
  if (await fingerprint(root) !== baseline) throw new Error('Repository baseline changed during verification');
  await git(root, ['apply', '--binary', '-'], bytes, execute);
}
