import { parse, stringify } from 'smol-toml';
import { isDeepStrictEqual } from 'node:util';
import * as z from 'zod/v4';
import { assertNonSecret } from './security.js';

const environment = z.record(z.string().refine(name => !/key|token|secret|password|credential|auth/i.test(name)), z.string());
const serverSchema = z.object({
  command: z.string().min(1), args: z.array(z.string()),
  env: environment.optional(),
  envOverrides: environment.optional(),
}).strict();
export type ServerRegistration = z.infer<typeof serverSchema>;
export type HostFormat = 'codex-toml' | 'mcp-json';
type Table = Record<string, unknown>;

function table(value: unknown): Table {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected configuration table');
  return value as Table;
}
function decode(text: string, format: HostFormat): Table {
  try {
    return table(format === 'codex-toml'
      ? parse(text.replace(/^\uFEFF/, ''), { integersAsBigInt: true, unsafeKeyBehaviour: 'throw' })
      : JSON.parse(text.replace(/^\uFEFF/, '')));
  } catch { throw new Error('Invalid host configuration; contents withheld'); }
}
function values(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(values);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, values(entry)]));
  }
  return value;
}
const equal = (left: unknown, right: unknown) => isDeepStrictEqual(values(left), values(right));
const ordered = (value: Record<string, string> | undefined) => Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b, 'en')));

/** Only launch details are managed. Permissions, disable flags and credentials remain host-owned. */
export function reconcileHost(text: string | null, format: HostFormat, desired: unknown): {
  text: string; changedServers: string[];
} {
  let servers: Record<string, ServerRegistration>;
  try {
    assertNonSecret(desired);
    servers = z.record(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), serverSchema).parse(desired);
  } catch { throw new Error('Invalid or secret-bearing registration manifest'); }
  const before = text === null ? {} : decode(text, format);
  const key = format === 'codex-toml' ? 'mcp_servers' : 'mcpServers';
  const current = before[key] === undefined ? {} : table(before[key]);
  const merged = { ...current };
  const changedServers: string[] = [];
  for (const [name, desiredServer] of Object.entries(servers).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const old = current[name] === undefined ? {} : table(current[name]);
    // Never convert a remote/custom transport into local execution implicitly.
    if ('url' in old || ('type' in old && old.type !== 'stdio')) throw new Error('Host transport conflict; explicit migration required');
    const updated: Table = { ...old, command: desiredServer.command, args: desiredServer.args };
    if (desiredServer.env || desiredServer.envOverrides) {
      // Existing environment wins: preserves credentials and restrictive workspace policies.
      updated.env = { ...ordered(desiredServer.env), ...(old.env === undefined ? {} : table(old.env)), ...ordered(desiredServer.envOverrides) };
    }
    if (!equal(old, updated)) changedServers.push(name);
    merged[name] = updated;
  }
  if (!changedServers.length) return { text: text ?? (format === 'codex-toml' ? '' : '{}\n'), changedServers };
  const after = { ...before, [key]: merged };
  const output = format === 'codex-toml' ? stringify(after, { numbersAsFloat: true }) : JSON.stringify(after, null, 2) + '\n';
  if (!equal(decode(output, format), after)) throw new Error('Host serialization would change configuration types');
  return { text: output, changedServers };
}
