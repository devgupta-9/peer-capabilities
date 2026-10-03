import { createHash } from 'node:crypto';

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).sort().filter(key => object[key] !== undefined)
    .map(key => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}';
}
export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function contentHash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
