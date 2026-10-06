import path from 'node:path';
import { directoryIdentity, containsDirectory, assertIdentity, type DirectoryIdentity } from './filesystem-identity.js';

import { runCapture } from './process.js';

export type AuthorizedWorkingDirectory = {
  cwd: string;
  gitRoot: string;
  allowedRoots: string[];
};

async function canonicalDirectory(value: string): Promise<string> {
  return directoryIdentity(value).canonicalPath;
}

function containsPath(root: string, candidate: string): boolean {
  return containsDirectory(directoryIdentity(root), directoryIdentity(candidate));
}

async function gitRoot(cwd: string): Promise<string | null> {
  const result = await runCapture('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
    timeoutSeconds: 15,
  });
  if (result.code !== 0 || result.timedOut || result.stdoutTruncated || result.stderrTruncated) return null;
  const root = result.stdout.trim();
  return root ? canonicalDirectory(root) : null;
}

function configuredRoots(): string[] {
  return (process.env.PEER_AGENTS_ALLOWED_ROOTS ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const pinnedRoots = new Map<string, DirectoryIdentity>();
function allowedRoot(value: string): string {
  const display = path.resolve(value);
  const current = directoryIdentity(display);
  const pinned = pinnedRoots.get(display);
  if (pinned) {
    assertIdentity(pinned);
    if (current.key !== pinned.key) throw new Error('Delegation root scope changed');
  } else pinnedRoots.set(display, current);
  return current.canonicalPath;
}

export async function authorizeWorkingDirectory(
  requestedCwd: string,
  options: { allowedRoots?: string[]; serverCwd?: string } = {},
): Promise<AuthorizedWorkingDirectory> {
  const cwd = await canonicalDirectory(requestedCwd);
  const repositoryRoot = await gitRoot(cwd);
  if (!repositoryRoot) {
    throw new Error(`Delegation working directory must be inside a Git repository: ${cwd}`);
  }

  const configured = options.allowedRoots ?? configuredRoots();
  let roots = configured.map(allowedRoot);
  if (!roots.length) {
    const serverCwd = await canonicalDirectory(options.serverCwd ?? process.cwd());
    const serverRepositoryRoot = await gitRoot(serverCwd);
    if (!serverRepositoryRoot) {
      throw new Error(
        'No safe delegation root is available. Start peer-agents from a Git repository or set PEER_AGENTS_ALLOWED_ROOTS to explicit project roots.',
      );
    }
    roots = [allowedRoot(serverRepositoryRoot)];
  }

  if (!roots.some((root) => containsPath(root, repositoryRoot))) {
    throw new Error(`Git repository is outside configured delegation roots: ${repositoryRoot}`);
  }

  return { cwd, gitRoot: repositoryRoot, allowedRoots: roots };
}
