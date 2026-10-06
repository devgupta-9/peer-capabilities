import { realpathSync, statSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** One native resolver for every security/ownership boundary; never case-fold paths. */
export type DirectoryIdentity = Readonly<{
  displayPath: string; canonicalPath: string; objectId: string; key: string;
}>;
export function directoryIdentity(value: string): DirectoryIdentity {
  const displayPath = path.resolve(value);
  const canonicalPath = realpathSync.native(displayPath);
  const info = statSync(canonicalPath, { bigint: true });
  if (!info.isDirectory() || info.ino === 0n) throw new Error('Directory identity unavailable');
  const objectId = `${info.dev}:${info.ino}`;
  const key = createHash('sha256').update(JSON.stringify([canonicalPath, objectId])).digest('hex');
  return Object.freeze({ displayPath, canonicalPath, objectId, key });
}
export function assertIdentity(expected: DirectoryIdentity): void {
  const actual = directoryIdentity(expected.canonicalPath);
  if (actual.key !== expected.key || lstatSync(expected.canonicalPath).isSymbolicLink()) {
    throw new Error('Filesystem root scope/identity changed');
  }
}
/** Walk physical ancestors, avoiding path.relative's case-insensitive Windows comparison. */
export function containsDirectory(root: DirectoryIdentity, candidate: DirectoryIdentity): boolean {
  assertIdentity(root); assertIdentity(candidate);
  let current = candidate;
  for (;;) {
    if (current.key === root.key) return true;
    const parent = path.dirname(current.canonicalPath);
    if (parent === current.canonicalPath) return false;
    current = directoryIdentity(parent);
  }
}
/** Lexical guard only: callers must also inspect physical parents/links before effects. */
export function childPath(root: string, relative: string): string {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => p === '..' || p.includes(':'))) {
    throw new Error('Path escaped root');
  }
  const result = path.resolve(root, relative);
  if (result === root) throw new Error('Root is not a file destination');
  return result;
}
