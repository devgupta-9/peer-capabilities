#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import path from 'node:path';
export function requireNode24(version) {
  if (!/^\d+\./.test(version) || Number(version.split('.')[0]) < 24) {
    throw new Error('Peer Capabilities requires Node.js 24 or newer. Upgrade Node before running setup; no environment changes were made.');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    requireNode24(process.versions.node);
    const { main } = await import('../dist/runtime/cli.js');
    await main(process.argv.slice(2));
  } catch (error) {
    // Structured failures must not echo arbitrary provider/config input.
    console.error('Peer Capabilities: ' + (Number(process.versions.node.split('.')[0]) < 24 ? error.message : 'operation failed; inspect non-secret status and configuration. No automatic fallback.'));
    process.exitCode = 1;
  }
}
