import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { runCapture } from './process.js';

export type ImplementationPatch = {
  patchPath: string | null;
  patchBytes: number;
  patchSha256?: string;
  verified: boolean;
  cleanupWarning?: string;
};

export async function finalizeImplementationWorktree(input: {
  root: string;
  worktree: string;
  runId: string;
  target: 'codex' | 'antigravity';
  runDirectory?: string;
}): Promise<ImplementationPatch> {
  const runDirectory = input.runDirectory ?? path.join(homedir(), '.peer-agents', 'runs');
  const patchPath = path.join(runDirectory, `${input.runId}-${input.target}.patch`);
  const temporaryPatchPath = `${patchPath}.partial`;

  try {
    const add = await runCapture('git', ['-C', input.worktree, 'add', '-A'], { timeoutSeconds: 30 });
    if (add.code !== 0) {
      throw new Error(`Failed to stage delegated changes: ${add.stderr || add.stdout}`);
    }

    await mkdir(runDirectory, { recursive: true });
    await rm(temporaryPatchPath, { force: true });
    const diff = await runCapture(
      'git',
      [
        '-C', input.worktree,
        'diff', '--cached', '--binary', '--no-color', '--full-index',
        `--output=${temporaryPatchPath}`,
      ],
      { timeoutSeconds: 60 },
    );
    if (diff.code !== 0) {
      throw new Error(`Failed to export delegated patch: ${diff.stderr || diff.stdout}`);
    }

    const patchStat = await stat(temporaryPatchPath);
    if (patchStat.size === 0) {
      await unlink(temporaryPatchPath);
      const cleanupWarning = await removeWorktree(input.root, input.worktree);
      return { patchPath: null, patchBytes: 0, verified: true, ...(cleanupWarning ? { cleanupWarning } : {}) };
    }

    const verify = await runCapture(
      'git',
      ['-C', input.root, 'apply', '--check', '--binary', temporaryPatchPath],
      { timeoutSeconds: 60 },
    );
    if (verify.code !== 0) {
      throw new Error(`Exported patch failed git apply --check: ${verify.stderr || verify.stdout}`);
    }

    await rename(temporaryPatchPath, patchPath);
    const patch = await readFile(patchPath);
    const patchSha256 = createHash('sha256').update(patch).digest('hex');
    const cleanupWarning = await removeWorktree(input.root, input.worktree);
    return {
      patchPath,
      patchBytes: patch.length,
      patchSha256,
      verified: true,
      ...(cleanupWarning ? { cleanupWarning } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message} Delegated worktree preserved at ${input.worktree}; partial patch, if any, is ${temporaryPatchPath}.`,
      { cause: error },
    );
  }
}

async function removeWorktree(root: string, worktree: string): Promise<string | undefined> {
  const remove = await runCapture('git', ['-C', root, 'worktree', 'remove', '--force', worktree], {
    timeoutSeconds: 60,
  });
  if (remove.code !== 0) {
    return `Verified patch was saved, but temporary worktree cleanup failed; inspect ${worktree}. ${remove.stderr || remove.stdout}`;
  }
  if (existsSync(worktree)) {
    try {
      await rm(worktree, { recursive: true, force: true });
    } catch {
      return `Git detached the worktree, but the temporary directory remains at ${worktree}.`;
    }
  }
  return undefined;
}
