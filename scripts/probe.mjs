// Local stdio handshake only: never print raw configuration, env, stderr, prompts, or tool payloads.
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

let request = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) request += chunk;

let spec;
try {
  spec = JSON.parse(request);
} catch {
  console.log(JSON.stringify({ ok: false, error: 'invalid_input' }));
  process.exit(1);
}
const maxOutputBytes = spec.maxOutputBytes ?? 2_000_000;
if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 16_000_000) {
  console.log(JSON.stringify({ ok: false, error: 'invalid_output_limit' }));
  process.exit(1);
}

const systemKeys = new Set(['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','TMPDIR','LANG','LC_ALL']);
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => systemKeys.has(name.toUpperCase()) || (spec.env_vars ?? []).includes(name)));
const child = spawn(spec.command, spec.args ?? [], {
  cwd: spec.cwd,
  env: { ...childEnv, ...(spec.env ?? {}) },
  shell: false,
  windowsHide: true,
  detached: process.platform !== 'win32',
  stdio: ['pipe', 'pipe', 'pipe'],
});

let finished = false;
let buffer = '';
let bytes = 0;
let stderrBytes = 0;
let names = [];
const decoder = new StringDecoder('utf8');
let explicitModelSchema = false;
let shutdownTimer;
const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), 110_000);

function finish(result) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  child.stdin.end();
  // Give launchers time to close their children on EOF before terminating the owned tree.
  if (child.pid && child.exitCode === null) shutdownTimer = setTimeout(() => {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => child.kill());
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
    }
  }, 2000);
  console.log(JSON.stringify(result));
}
child.on('close', () => clearTimeout(shutdownTimer));

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
  if (bytes > maxOutputBytes) {
    finish({ ok: false, error: 'excessive_output' });
    return;
  }
  buffer += decoder.write(chunk);
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

    if (message.method === 'roots/list') {
      send({ id: message.id, result: { roots: spec.workspace ? [{ uri: pathToFileURL(spec.workspace).href }] : [] } });
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
      if (spec.verify) {
        if (!names.includes(spec.verify.name)) { finish({ ok: false, error: 'verification_tool_missing' }); return; }
        send({ id: 4, method: 'tools/call', params: { name: spec.verify.name, arguments: spec.verify.arguments ?? {} } });
      } else if (names.includes('peer_capabilities')) {
        send({ id: 3, method: 'tools/call', params: { name: 'peer_capabilities', arguments: { cwd: spec.workspace ?? spec.cwd } } });
      } else {
        finish({ ok: true, tools: names, explicitModelSchema });
      }
    }

    if (message.id === 4) {
      const verified = Boolean(message.result) && !message.error && !message.result?.isError;
      finish({ ok: verified, tools: names, functionalCall: spec.verify.name, functionalVerified: verified,
        scope: 'fresh-process single tool call, not active-host or all-backend certification' });
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
          antigravityModelsAvailable: payload.antigravity?.models?.length > 0,
          antigravityDiscovery: {
            cli: payload.antigravity?.cliDiscovery?.status ?? 'UNKNOWN',
            cliDurationMs: payload.antigravity?.cliDiscovery?.durationMs ?? null,
            catalog: payload.antigravity?.modelDiscovery?.status ?? 'UNKNOWN',
            catalogDurationMs: payload.antigravity?.modelDiscovery?.durationMs ?? null,
          },
          workspaceReady: payload.workspace?.ready === true,
          workspaceEvidenceScope: 'simulated-probe-host',
          antigravityReadiness: payload.antigravity?.readiness ?? { authentication: 'UNKNOWN', verification: 'UNVERIFIED' },
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
    capabilities: spec.workspace ? { roots: { listChanged: true } } : {},
    clientInfo: { name: 'local-ai-health', version: '1.0.0' },
  },
});
