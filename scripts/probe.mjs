// Local stdio handshake only: never print raw configuration, env, stderr, prompts, or tool payloads.
import { spawn } from 'node:child_process';

let request = '';
for await (const chunk of process.stdin) request += chunk;

let spec;
try {
  spec = JSON.parse(request);
} catch {
  console.log(JSON.stringify({ ok: false, error: 'invalid_input' }));
  process.exit(1);
}

const child = spawn(spec.command, spec.args ?? [], {
  cwd: spec.cwd,
  env: { ...process.env, ...(spec.env ?? {}) },
  shell: false,
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
});

let finished = false;
let buffer = '';
let bytes = 0;
let stderrBytes = 0;
let names = [];
let explicitModelSchema = false;
const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), 45_000);

function finish(result) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  child.kill();
  console.log(JSON.stringify(result));
}

function send(message) {
  if (!finished) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}

child.on('error', () => finish({ ok: false, error: 'spawn_failed' }));
child.stdin.on('error', () => finish({ ok: false, error: 'stdin_failed' }));
child.on('exit', () => {
  if (!finished) finish({ ok: false, error: 'early_exit' });
});
child.stderr.on('data', (chunk) => {
  stderrBytes += chunk.length;
  if (stderrBytes > 2_000_000) finish({ ok: false, error: 'excessive_stderr' });
});
child.stdout.on('data', (chunk) => {
  bytes += chunk.length;
  if (bytes > 2_000_000) {
    finish({ ok: false, error: 'excessive_output' });
    return;
  }
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }

    if (message.id === 1) {
      if (message.error || !message.result) {
        finish({ ok: false, error: 'initialize_failed' });
        return;
      }
      send({ method: 'notifications/initialized' });
      send({ id: 2, method: 'tools/list', params: {} });
    }

    if (message.id === 2) {
      if (message.error || !Array.isArray(message.result?.tools)) {
        finish({ ok: false, error: 'tools_list_failed' });
        return;
      }
      names = message.result.tools.map((tool) => tool.name);
      const delegate = message.result.tools.find((tool) => tool.name === 'delegate_peer');
      explicitModelSchema = Boolean(delegate)
        && ['model', 'effort', 'selectionReason'].every((key) => delegate.inputSchema.required?.includes(key))
        && !('tier' in delegate.inputSchema.properties);
      if (names.includes('peer_capabilities')) {
        send({ id: 3, method: 'tools/call', params: { name: 'peer_capabilities', arguments: {} } });
      } else {
        finish({ ok: true, tools: names, explicitModelSchema });
      }
    }

    if (message.id === 3) {
      if (message.error || message.result?.isError) {
        finish({ ok: false, error: 'peer_capabilities_failed' });
        return;
      }
      try {
        const payload = JSON.parse(message.result.content?.[0]?.text ?? '{}');
        finish({
          ok: true,
          tools: names,
          explicitModelSchema,
          peerCapabilitiesChecked: true,
          codexAvailable: payload.codex?.available === true,
          antigravityAvailable: payload.antigravity?.available === true,
        });
      } catch {
        finish({ ok: false, error: 'peer_capabilities_invalid' });
      }
    }
  }
});

send({
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'local-ai-health', version: '1.0.0' },
  },
});
