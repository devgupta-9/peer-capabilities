import { gzipSync, gunzipSync } from 'node:zlib';
import * as z from 'zod/v4';
import { canonical, contentHash, digest } from './identity.js';

export const MAX_ARCHIVE_RECORD_BYTES = 16 * 1024 * 1024;
export const MAX_ARCHIVE_BATCH_BYTES = 32 * 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const action = z.enum(['archive', 'restore']);
export const storageSelectionSchema = z.object({
  ids: z.array(hash).min(1).max(100).refine(ids => new Set(ids).size === ids.length),
}).strict();
const change = z.object({ id: hash, beforeHash: hash, afterHash: hash,
  from: z.enum(['HOT', 'ARCHIVED']), to: z.enum(['HOT', 'ARCHIVED']),
  beforeBytes: z.number().int().positive(), afterBytes: z.number().int().positive(),
}).strict();
export const storagePlanSchema = z.object({
  schemaVersion: z.literal(1), operationId: z.uuid(), action, ids: storageSelectionSchema.shape.ids,
  scope: hash, stateHash: hash, changes: z.array(change).min(1).max(100), digest: hash,
}).strict();
export type StoragePlan = z.infer<typeof storagePlanSchema>;
export const storageReceiptSchema = z.object({
  schemaVersion: z.literal(1), operationId: z.uuid(), action, planDigest: hash,
  completedAt: z.iso.datetime(), changes: z.array(change).min(1).max(100), hash,
}).strict();
export function readStorageReceipt(body: string, operationId: string) {
  const receipt = storageReceiptSchema.parse(JSON.parse(body));
  const { hash, ...value } = receipt;
  if (receipt.operationId !== operationId || digest(value) !== hash) throw new Error('Corrupt evidence storage journal');
  return receipt;
}
const archiveSchema = z.object({
  evidenceArchive: z.literal(1), codec: z.literal('gzip-base64'), bodyHash: hash,
  originalBytes: z.number().int().positive().max(MAX_ARCHIVE_RECORD_BYTES),
  data: z.string().max(MAX_ARCHIVE_RECORD_BYTES * 2).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict();

export function archivedEvidence(body: string): boolean {
  const parsed: unknown = JSON.parse(body);
  return Boolean(parsed && typeof parsed === 'object' && 'evidenceArchive' in parsed);
}

/** Decode the exact original JSON bytes before the ordinary evidence integrity checks. */
export function restoreEvidenceBody(body: string): string {
  const archive = archiveSchema.parse(JSON.parse(body));
  const compressed = Buffer.from(archive.data, 'base64');
  if (compressed.toString('base64') !== archive.data) throw new Error('Invalid archive encoding');
  const original = gunzipSync(compressed, { maxOutputLength: archive.originalBytes });
  if (original.length !== archive.originalBytes || contentHash(original) !== archive.bodyHash) throw new Error('Invalid archive integrity');
  const text = original.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(original)) throw new Error('Invalid archive text');
  return text;
}

export function archiveEvidenceBody(body: string): string {
  const original = Buffer.from(body, 'utf8');
  if (original.length > MAX_ARCHIVE_RECORD_BYTES) throw new Error('Evidence exceeds the archive record limit');
  const encoded = canonical({ evidenceArchive: 1, codec: 'gzip-base64', bodyHash: contentHash(original),
    originalBytes: original.length, data: gzipSync(original).toString('base64') });
  if (Buffer.byteLength(encoded, 'utf8') >= original.length) throw new Error('Archival would not reduce stored evidence bytes');
  if (restoreEvidenceBody(encoded) !== body) throw new Error('Archive round-trip verification failed');
  return encoded;
}
