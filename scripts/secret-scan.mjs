import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const argv = process.argv.slice(2), at = argv.indexOf('--root');
const root = path.resolve(at < 0 ? fileURLToPath(new URL('../', import.meta.url)) : argv[at + 1]);
const staged = argv.includes('--staged'), history = argv.includes('--history');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|LANG)$/i.test(k)));
const git = args => execFileSync('git', ['-C', root, ...args], { maxBuffer: 64 * 1024 * 1024, env });
const patterns = {
  private_key: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  github_token: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  aws_access_key: /AKIA[0-9A-Z]{16}/,
  google_api_key: /AIza[0-9A-Za-z_-]{30,}/,
  slack_token: /xox[baprs]-[A-Za-z0-9-]{10,}/,
  stripe_secret: /sk_(?:live|test)_[A-Za-z0-9]{16,}/,
  jwt: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  bearer_value: /authorization\s*[:=]\s*["']?bearer\s+[A-Za-z0-9._-]{12,}/i,
  assigned_secret: /(?:api[_-]?key|client[_-]?secret|password|access[_-]?token)(?:\\?["'])?\s*[:=]\s*(?:\\?["'])[^"'\r\n]{12,}(?:\\?["'])/i,
  npm_token: /npm_[A-Za-z0-9]{30,}/,
};
const forbidden = /(^|\/)(\.env($|\.)|config\.toml$|mcp_config\.json$|auth\.json$|credentials?[^/]*\.json$|[^/]+\.(pem|key|pfx|p12)$)/i;
const findings = [];
let scanned = 0;
function scan(label, bytes, checkName = true, personalPaths = true) {
  scanned++;
  if (checkName && forbidden.test(label)) findings.push({ category: 'forbidden_filename', file: label });
  const text = bytes.toString('utf8');
  if (personalPaths && /\b[A-Z]:\\Users\\(?!you\b|<user>\b)[^\\\s"']+/i.test(text)) findings.push({ category: 'personal_absolute_path', file: label });
  for (const [category, pattern] of Object.entries(patterns)) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))) {
      // Historical scanner source contains this exact regex literal, not a key.
      const knownDetector = "'" + ['AIza', '[0-9A-Za-z_-]', '{30,}'].join('') + "'";
      if (category === 'assigned_secret' && match[0].endsWith(knownDetector)) continue;
      findings.push({ category, file: label });
    }
  }
}
try {
  if (history) {
    for (const entry of git(['rev-list', '--objects', '--all']).toString('utf8').split('\n').filter(Boolean)) {
      const oid = entry.split(' ')[0];
      if (git(['cat-file', '-t', oid]).toString().trim() === 'blob') scan('history:' + oid, git(['cat-file', 'blob', oid]), false, false);
    }
  } else {
    const names = (staged ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
      : Buffer.concat([git(['ls-files', '-z']), git(['ls-files', '--others', '--exclude-standard', '-z'])])).toString('utf8').split('\0').filter(Boolean);
    for (const name of new Set(names)) {
      const full = path.resolve(root, name);
      if (!full.startsWith(root + path.sep)) throw new Error('Path outside scan scope');
      if (staged) scan(name, git(['show', ':' + name]));
      else {
        let info; try { info = lstatSync(full); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
        if (info.isSymbolicLink()) throw new Error('Symlink candidate requires review');
        if (info.isFile()) scan(name, readFileSync(full));
      }
    }
  }
  console.log(JSON.stringify({ ok: findings.length === 0, scope: history ? 'history' : staged ? 'staged' : 'tracked-and-untracked', scanned, findings }));
  process.exitCode = findings.length ? 1 : 0;
} catch { console.log(JSON.stringify({ ok: false, error: 'Scan incomplete; refusing clean result', scanned })); process.exitCode = 2; }
