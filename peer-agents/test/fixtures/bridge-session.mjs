import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function bridgeSession(cwd, env, initialRoots, modern = false) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../dist/index.js', import.meta.url))], {
    cwd, env: { ...process.env, PEER_AGY_BIN: process.execPath, PEER_CODEX_BIN: process.execPath,
      PEER_AGENTS_ALLOWED_ROOTS: '', PEER_AGENTS_WORKSPACE_MODE: 'AUTO_ACTIVE', ...env },
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  let roots = initialRoots, seq = 0, buffer = '', diagnostics = '';
  const pending = new Map();
  const send = value => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
  child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4000); });
  child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.method === 'roots/list') { send({ id: message.id, result: { roots: roots.map(root => ({ uri: pathToFileURL(root).href })) } }); continue; }
      const p = pending.get(message.id);
      if (p) { pending.delete(message.id); clearTimeout(p.timer); message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result); }
    }
  });
  const fail = error => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); };
  child.on('error', fail); child.on('exit', code => fail(new Error(`Bridge exited ${code}: ${diagnostics}`)));
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error('Bridge request timed out: ' + diagnostics)); }, 20000);
    pending.set(id, { resolve, reject, timer }); send({ id, method, params });
  });
  const capabilities = roots === undefined ? {} : { roots: { listChanged: true } };
  const clientInfo = { name: 'workspace-test-host', version: '1' };
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientInfo': clientInfo, 'io.modelcontextprotocol/clientCapabilities': capabilities };
  if (modern) await request('server/discover', { _meta: meta });
  else {
    await request('initialize', { protocolVersion: '2025-03-26', capabilities, clientInfo });
    send({ method: 'notifications/initialized' });
  }
  return { pid: child.pid,
    roots: value => { roots = value; if (!modern) send({ method: 'notifications/roots/list_changed' }); },
    call: async (name, args) => {
      const params = { name, arguments: args, ...(modern ? { _meta: meta } : {}) };
      let result = await request('tools/call', params);
      if (result.resultType === 'input_required') {
        const inputResponses = {};
        for (const [key, input] of Object.entries(result.inputRequests ?? {})) {
          if (input.method !== 'roots/list') throw new Error('Unexpected host request');
          inputResponses[key] = { roots: roots.map(root => ({ uri: pathToFileURL(root).href })) };
        }
        result = await request('tools/call', { ...params, inputResponses });
      }
      return JSON.parse(result.content[0].text);
    },
    close: async () => { child.stdin.end(); child.kill(); await closed; },
  };
}
