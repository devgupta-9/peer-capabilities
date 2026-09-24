import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { runCapture } from './process.js';

export type AuthorizedWorkingDirectory = {
  cwd: string;
  gitRoot: string;
  allowedRoots: string[];
};

async function canonicalDirectory(value: string): Promise<string> {
  const resolved = await realpath(path.resolve(value));
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new Error(`Delegation path is not a directory: ${resolved}`);
  return resolved;
}

function containsPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function gitRoot(cwd: string): Promise<string | null> {
  const result = await runCapture('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
    timeoutSeconds: 15,
  });
  if (result.code !== 0) return null;
  const root = result.stdout.trim();
  return root ? canonicalDirectory(root) : null;
}

function configuredRoots(): string[] {
  return (process.env.PEER_AGENTS_ALLOWED_ROOTS ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
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
  let roots = await Promise.all(configured.map(canonicalDirectory));
  if (!roots.length) {
    const serverCwd = await canonicalDirectory(options.serverCwd ?? process.cwd());
    const serverRepositoryRoot = await gitRoot(serverCwd);
    if (!serverRepositoryRoot) {
      throw new Error(
        'No safe delegation root is available. Start peer-agents from a Git repository or set PEER_AGENTS_ALLOWED_ROOTS to explicit project roots.',
      );
    }
    roots = [serverRepositoryRoot];
  }

  if (!roots.some((root) => containsPath(root, repositoryRoot))) {
    throw new Error(`Git repository is outside configured delegation roots: ${repositoryRoot}`);
  }

  return { cwd, gitRoot: repositoryRoot, allowedRoots: roots };
}
