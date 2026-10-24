import * as z from 'zod/v4';
import { HostConfigurationStore, type HostTarget } from './host-configuration-store.js';

// Local operator interface only. Configuration contents and provider secrets never leave this process.
try {
  process.stdin.setEncoding('utf8');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 1024 * 1024) throw new Error('Oversized host setup request');
  }
  const request = z.object({
    action: z.enum(['preview', 'apply', 'rollback']), root: z.string().min(1),
    targets: z.array(z.object({ host: z.string(), relativePath: z.string(), format: z.enum(['codex-toml', 'mcp-json']), servers: z.record(z.string(), z.unknown()) }).strict()).default([]),
    expectedDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    operation: z.string().uuid().optional(),
    bindings: z.record(z.string(), z.partialRecord(z.enum(['peer-agents', 'jev', 'rea']), z.object({ runtimeRoot: z.string().optional(), entry: z.string().optional() }).strict())).optional(),
  }).strict().parse(JSON.parse(input));
  const store = new HostConfigurationStore(request.root);
  const targets = request.targets as HostTarget[];
  if (request.action === 'apply' && !request.expectedDigest) throw new Error('Apply needs the reviewed preview digest');
  if (request.action === 'rollback' && !request.operation) throw new Error('Rollback needs an operation ID');
  const result = request.action === 'preview' ? store.preview(targets)
    : request.action === 'apply' ? store.apply(targets, request.expectedDigest!, request.bindings) : store.rollback(request.operation!);
  process.stdout.write(JSON.stringify(result) + '\n');
} catch {
  process.stderr.write('Host configuration operation refused or incomplete. Inspect a fresh preview and local operation journal; no configuration contents are printed.\n');
  process.exitCode = 1;
}
