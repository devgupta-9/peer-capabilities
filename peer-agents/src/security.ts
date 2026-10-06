import { isSecretKey, redactSecrets, secretFindings } from '../security-policy.mjs';

const SYSTEM_KEYS = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR',
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES',
  'PROGRAMFILES(X86)', 'PROGRAMDATA', 'LANG', 'LC_ALL', 'TERM',
]);

/** Ambient application secrets are not an implicit subprocess capability. */
export function childEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  provider?: 'codex' | 'antigravity',
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  const providerKeys = provider === 'codex' ? ['CODEX_HOME'] : [];
  for (const [key, value] of Object.entries(source)) {
    if (SYSTEM_KEYS.has(key.toUpperCase()) || providerKeys.includes(key)) result[key] = value;
  }
  return result;
}

export function redact(value: string, source: NodeJS.ProcessEnv = process.env): string {
  let safe = redactSecrets(value);
  for (const [key, secret] of Object.entries(source)) {
    if (/secret|token|password|api.?key|credential/i.test(key) && secret && secret.length >= 8) {
      safe = safe.split(secret).join('[REDACTED]');
    }
  }
  return safe;
}

export function assertNonSecret(value: unknown): void {
  const inspect = (item: unknown): void => {
    if (item && typeof item === 'object') for (const [key, entry] of Object.entries(item)) {
      if (isSecretKey(key)) throw new Error('SECRET credential fields are forbidden in shared or durable state');
      inspect(entry);
    }
    if (typeof item === 'string' && (secretFindings(item).length || redact(item) !== item)) throw new Error('SECRET material is forbidden in shared or durable state');
  };
  inspect(value);
  const serialized = JSON.stringify(value);
  if (serialized === undefined || redact(serialized) !== serialized) {
    throw new Error('SECRET material is forbidden in shared or durable state');
  }
}
