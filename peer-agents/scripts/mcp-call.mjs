import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export async function callBridge(tool, args = {}, options = {}) {
  const bridgeRoot = fileURLToPath(new URL('../', import.meta.url));
  const child = spawn(process.execPath, [options.entry ?? path.join(bridgeRoot, 'dist/index.js'), ...(options.args ?? [])], {
    cwd: bridgeRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...options.env },
  });
  let sequence = 0;
  let buffer = '';
  let diagnostics = '';
  const pending = new Map();
  child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-8000); });
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        const waiter = pending.get(message.id);
        if (waiter) {
          pending.delete(message.id);
          message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result);
        }
      } catch (error) { for (const waiter of pending.values()) waiter.reject(error); }
    }
  });
  const fail = error => { for (const waiter of pending.values()) waiter.reject(error); pending.clear(); };
  child.on('error', fail);
  child.on('exit', code => fail(new Error(`Bridge exited ${code}: ${diagnostics}`)));
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const timeout = setTimeout(() => fail(new Error('MCP verification timed out')), ((args.timeoutSeconds ?? 30) + 30) * 1000);
  try {
    await request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'peer-verification', version: '1.0.0' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return tool === 'tools/list' ? await request('tools/list', {}) : await request('tools/call', { name: tool, arguments: args });
  } finally {
    clearTimeout(timeout);
    child.stdin.end();
    child.kill();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await callBridge(process.argv[2] ?? 'peer_capabilities', JSON.parse(process.argv[3] ?? '{}'));
  console.log(JSON.stringify(result, null, 2));
  if (result.isError) process.exitCode = 1;
}
