import * as z from 'zod/v4';
import { assertNonSecret } from '../security.js';
import { digest } from './identity.js';

const component = z.object({
  id: z.string().regex(/^[a-z][a-z0-9._-]*$/),
  kind: z.enum(['agent', 'adapter', 'mcp', 'skill', 'plugin', 'engineering-policy', 'security-policy', 'orchestrator', 'runtime', 'managed-file', 'integration']),
  optional: z.boolean(), recipe: z.enum(['observe', 'managed-file']), version: z.string().min(1),
  dependencies: z.array(z.string()).default([]), platforms: z.array(z.enum(['win32', 'darwin', 'linux'])).default([]),
  source: z.string().optional(), integrity: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  destination: z.string().optional(), content: z.string().optional(),
}).strict();
export const manifestSchema = z.object({ schemaVersion: z.literal(1), components: z.array(component) }).strict();
export type Manifest = z.infer<typeof manifestSchema>;
export function validateManifest(value: unknown): Manifest {
  assertNonSecret(value);
  function inspect(obj: unknown): void {
    if (typeof obj === 'string' && /https?:\/\/[^/\s]*@|[?&](?:token|key|password)=/i.test(obj)) throw new Error('Credential URL forbidden');
    if (obj && typeof obj === 'object') for (const [key, item] of Object.entries(obj)) {
      if (/^(?:api.?key|password|secret|token|credentials?|access.?token|client.?secret)$/i.test(key)) throw new Error('Credential field forbidden');
      inspect(item);
    }
  }
  inspect(value);
  const manifest = manifestSchema.parse(value);
  const ids = new Set(manifest.components.map(c => c.id));
  if (ids.size !== manifest.components.length) throw new Error('Duplicate component ID');
  for (const c of manifest.components) {
    if (c.dependencies.some(d => !ids.has(d) || d === c.id)) throw new Error('Invalid dependency');
    if (c.recipe === 'managed-file' && (!c.destination || c.content === undefined || !c.integrity)) throw new Error('Managed file requires content, destination and integrity');
    if (c.destination && (c.destination.includes('..') || /^[\\/]|^[a-z]:/i.test(c.destination))) throw new Error('Destination must stay within the selected root');
  }
  const visited = new Set<string>(); const active = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) throw new Error('Dependency cycle');
    if (visited.has(id)) return;
    active.add(id);
    for (const dep of manifest.components.find(c => c.id === id)!.dependencies) visit(dep);
    active.delete(id); visited.add(id);
  };
  for (const id of ids) visit(id);
  return manifest;
}
export function manifestDigest(manifest: Manifest): string { return digest(manifest); }
