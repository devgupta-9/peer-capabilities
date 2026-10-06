/** Dependency-free shared runtime/publication policy. Never returns matched values. */
export function isSecretKey(key) {
  return /^(?:apikey|clientsecret|password|accesstoken|refreshtoken|idtoken|sessiontoken|clienttoken|authorization|privatekey|credentials?)$/i.test(key.replace(/[_\-\s]/g, ''));
}
const fields = String.raw`(?:api[_-]?key|client[_-]?secret|password|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|client[_-]?token|authorization|private[_-]?key|credentials?)`;
const patterns = {
  ['private_' + 'key']: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:RSA |EC |OPENSSH |DSA |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----|$)/g,
  github_token: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  npm_token: /\bnpm_[A-Za-z0-9_]{30,}\b/g,
  openai_token: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  aws_access_key: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  google_api_key: /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  slack_token: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  stripe_secret: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  jwt: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  bearer_value: /\bBearer\s+[\w.\-+/=]{12,}/gi,
  authenticated_url: /https?:\/\/[^\s/@]+:[^\s/@]+@[^\s"'<>]+/gi,
  assigned_secret: new RegExp(String.raw`\b${fields}(?:\\*["'])?\s*[:=]\s*(?:\\*["'])[^"'\\\r\n]+(?:\\*["'])`, 'gi'),
  unquoted_secret: new RegExp(String.raw`\b${fields}\s*[:=]\s*(?![/"'\x60])[^\s"'\\,};]{8,}`, 'gi'),
  environment_secret: new RegExp(String.raw`^\s*(?:export\s+)?${fields}\s*=\s*[^\s"'\x60]{8,}\s*$`, 'gmi'),
};
export const forbiddenSecretFile = /(^|\/)(\.env($|\.)|config\.toml$|mcp_config\.json$|auth\.json$|credentials?[^/]*\.json$|[^/]+\.(pem|key|pfx|p12|ppk|jks|keystore)$)/i;

function transform(value, findings, depth = 0) {
  if (depth > 32) { findings.add('nesting_limit'); return '[REDACTED: nesting limit]'; }
  const sanitize = (item, level = depth) => {
    if (level > 32) { findings.add('nesting_limit'); return '[REDACTED: nesting limit]'; }
    if (typeof item === 'string') return transform(item, findings, level + 1);
    if (Array.isArray(item)) return item.map(entry => sanitize(entry, level + 1));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, entry]) => {
      if (isSecretKey(key)) {
        if (entry !== '[REDACTED]') findings.add('assigned_secret');
        return [key, '[REDACTED]'];
      }
      return [key, sanitize(entry, level + 1)];
    }));
    return item;
  };
  let text = value;
  try {
    const parsed = JSON.parse(value);
    // Includes JSON strings containing further escaped JSON, not just objects.
    if (parsed !== null && (typeof parsed === 'object' || typeof parsed === 'string')) {
      const safe = sanitize(parsed);
      if (JSON.stringify(safe) !== JSON.stringify(parsed)) text = JSON.stringify(safe);
    }
  } catch { /* Text diagnostics are handled by the same patterns as publication. */ }
  for (const [category, pattern] of Object.entries(patterns)) {
    text = text.replace(pattern, match => {
      if (category === 'assigned_secret' && /\\*["']\[REDACTED\]\\*["']$/.test(match)) return match;
      findings.add(category); return '[REDACTED]';
    });
  }
  return text;
}
export function redactSecrets(value) { return transform(value, new Set()); }
export function secretFindings(value) { const findings = new Set(); transform(value, findings); return [...findings]; }
