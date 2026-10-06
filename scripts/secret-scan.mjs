import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { secretFindings, forbiddenSecretFile, redactSecrets } from '../peer-agents/security-policy.mjs';
const argv = process.argv.slice(2), at = argv.indexOf('--root');
const root = path.resolve(at < 0 ? fileURLToPath(new URL('../', import.meta.url)) : argv[at + 1]);
const staged = argv.includes('--staged'), history = argv.includes('--history');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|LANG)$/i.test(k)));
const git = args => execFileSync('git', ['-C', root, ...args], { maxBuffer: 64 * 1024 * 1024, env, stdio: ['ignore', 'pipe', 'pipe'] });
const findings = [];
// Reviewed immutable historical blobs only. No path-, extension-, or test-directory exemptions.
// 1720...: runtime fixture's literal eight-character placeholder, never a credential.
// 141b...: old PowerShell detector's private_key regex definition, not key material.
const historicalSyntax = new Map([
  ['1720c9fd86258208f1eecf59aef04d2d37c8ea00', 'assigned_secret'],
  ['141bdaa679a6c53f9f60763730bbcfa7abda7a20', 'assigned_secret'],
]);
let scanned = 0;
function scan(label, bytes, checkName = true, personalPaths = true) {
  scanned++;
  const file = redactSecrets(label);
  if (checkName && forbiddenSecretFile.test(label)) findings.push({ category: 'forbidden_filename', file });
  const text = bytes.toString('utf8');
  if (personalPaths && /\b[A-Z]:\\Users\\(?!you\b|<user>\b)[^\\\s"']+/i.test(text)) findings.push({ category: 'personal_absolute_path', file });
  for (const category of secretFindings(text)) {
    if (history && label.startsWith('history:') && historicalSyntax.get(label.slice(8)) === category) continue;
    findings.push({ category, file });
  }
}
try {
  if (staged && history) throw new Error('Select one scan scope');
  if (history) {
    if (git(['rev-parse', '--is-shallow-repository']).toString().trim() !== 'false') throw new Error('Incomplete shallow history');
    const entries = git(['rev-list', '--objects', '--all', 'HEAD', '--missing=error']).toString('utf8').split('\n').filter(Boolean);
    if (!entries.length) throw new Error('No reachable history');
    for (const entry of entries) {
      const oid = entry.split(' ')[0];
      const type = git(['cat-file', '-t', oid]).toString().trim();
      if (type === 'blob' || type === 'commit' || type === 'tag') scan('history:' + oid, git(['cat-file', type, oid]), false, false);
      if (type === 'tree') {
        for (const item of git(['ls-tree', '-z', oid]).toString('utf8').split('\0').filter(Boolean)) {
          const name = item.slice(item.indexOf('\t') + 1);
          if (forbiddenSecretFile.test(name)) findings.push({ category: 'forbidden_filename', file: 'history-tree:' + oid });
        }
      }
    }
  } else {
    const names = (staged ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
      : Buffer.concat([git(['ls-files', '-z']), git(['ls-files', '--others', '--exclude-standard', '-z'])])).toString('utf8').split('\0').filter(Boolean);
    for (const name of new Set(names)) {
      const full = path.resolve(root, name);
      if (path.isAbsolute(name) || name.split(/[\\/]/).includes('..') || full === root) throw new Error('Path outside scan scope');
      if (staged) scan(name, git(['show', ':' + name]));
      else {
        let current = root;
        for (const component of name.split('/')) {
          current = path.join(current, component);
          try { if (lstatSync(current).isSymbolicLink()) throw new Error('Symlink candidate requires review'); }
          catch (e) { if (e.code !== 'ENOENT') throw e; }
        }
        let info; try { info = lstatSync(full); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
        if (info.isSymbolicLink()) throw new Error('Symlink candidate requires review');
        if (info.isFile()) scan(name, readFileSync(full));
      }
    }
  }
  console.log(JSON.stringify({ ok: findings.length === 0, scope: history ? 'fetched-reachable-history' : staged ? 'staged' : 'tracked-and-untracked', scanned, findings }));
  process.exitCode = findings.length ? 1 : 0;
} catch { console.log(JSON.stringify({ ok: false, error: 'Scan incomplete; refusing clean result', scanned })); process.exitCode = 2; }
