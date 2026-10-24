import { test } from 'node:test';
import assert from 'node:assert/strict';
import { antigravityCommand, antigravitySandboxMode, parseAntigravityResult, discoverAntigravityModels, discoverAntigravityVersion, toolPathHash } from '../dist/antigravity.js';

const complete = (stdout, overrides = {}) => ({ code: 0, stdout, stderr: '', timedOut: false,
  cancelled: false, stdoutTruncated: false, stderrTruncated: false, durationMs: 12, ...overrides });
const final = (result) => JSON.stringify({ event: 'result', result });

test('permission-controlled mode is explicit, validated and never an automatic sandbox fallback', () => {
  assert.equal(antigravitySandboxMode(''), 'required');
  assert.equal(antigravitySandboxMode('permissions-only'), 'permissions-only');
  assert.throws(() => antigravitySandboxMode('off'));
  const c = antigravityCommand({ prompt: 'review', cwd: 'project', mode: 'REVIEW', timeoutSeconds: 60,
    sandboxMode: 'permissions-only', choice: { model: 'gemini-3.1-pro-high', effort: 'high', fallback: false } });
  assert.ok(c.args.includes('--sandbox=false'));
  assert.ok(c.args.includes('plan'));
  assert.ok(!c.args.includes('--dangerously-skip-permissions'));
});

test('AGY sends long Unicode prompts over stdin without disabling plan mode', () => {
  const prompt = 'review 🙂\n'.repeat(6000);
  const command = antigravityCommand({ prompt, cwd: 'project', mode: 'REVIEW',
    choice: { model: 'gemini-3.1-pro-high', effort: 'high', fallback: false }, timeoutSeconds: 90 });
  assert.equal(JSON.parse(command.input).message.content, prompt);
  assert.ok(command.input.endsWith('\n'));
  assert.ok(!command.args.includes(prompt));
  assert.ok(!command.args.includes('--disable-slash-commands'));
  assert.ok(!command.args.includes('--dangerously-skip-permissions'));
  assert.ok(command.args.includes('--sandbox'));
  assert.equal(command.args[command.args.indexOf('--mode') + 1], 'plan');
  assert.equal(command.args[command.args.indexOf('--model') + 1], 'gemini-3.1-pro-high');
});

test('AGY accepts the terminal result, not intermediate streamed text', () => {
  const result = parseAntigravityResult(complete(JSON.stringify({ event: 'step_update',
    step_update: { text_delta: 'partial' } }) + '\n' + final({ status: 'SUCCESS', response: 'Complete 🙂',
    conversation_id: 'session', usage: { input_tokens: 1 } }) + '\n'));
  assert.equal(result.response, 'Complete 🙂');
  assert.equal(result.conversationId, 'session');
});

test('AGY cannot report success for missing, truncated, failed or empty results', () => {
  for (const capture of [complete(''), complete('not JSON'),
    complete(final({ status: 'SUCCESS', response: '' })),
    complete(final({ status: 'ERROR', response: 'partial', error: 'quota exhausted' })),
    complete(final({ status: 'SUCCESS', response: 'partial', denied_actions: [{ action: 'command' }] })),
    complete(final({ status: 'SUCCESS', response: 'partial' }), { stdoutTruncated: true }),
    complete(final({ status: 'SUCCESS', response: 'late' }), { timedOut: true }),
    complete(final({ status: 'SUCCESS', response: 'cancelled' }), { cancelled: true }),
    complete(final({ status: 'SUCCESS', response: 'I could not read' }), { stderr: 'Permission auto-denied' })]) {
    assert.throws(() => parseAntigravityResult(capture));
  }
});

test('a sandbox tool failure cannot be masked by a SUCCESS terminal response', () => {
  const error = JSON.stringify({ event: 'step_update', step_update: { state: 'ERROR', tool_name: 'run_command',
    tool_info: { error: { message: 'exebox: process security environments are not supported' } } } });
  assert.throws(() => parseAntigravityResult(complete(error + '\n' + final({ status: 'SUCCESS', response: 'Approved' }))), /tool could not execute/);
});

test('DONE tool events carrying errors cannot hide permission or sandbox failures', () => {
  for (const message of ['permission denied', 'exebox: unsupported sandbox']) {
    const event = { event: 'step_update', step_update: { state: 'DONE', step_type: 'tool',
      tool_name: 'run_command', tool_info: { name: 'run_command', error: { type: 'tool_error', message } } } };
    assert.throws(() => parseAntigravityResult(complete(JSON.stringify(event) + '\n' +
      final({ status: 'SUCCESS', response: 'Approved' }))), /permission|sandbox/i);
  }
});

test('AGY records successful tool evidence without exporting raw parameters or output', () => {
  const events = [
    { event: 'step_update', step_update: { state: 'ACTIVE', tool_name: 'run_command',
      tool_info: { parameters: { CommandLine: 'git status --short' } } } },
    { event: 'step_update', step_update: { state: 'DONE', tool_name: 'run_command',
      tool_info: { parameters: { CommandLine: 'git status --short', Cwd: process.cwd() }, output: 'private-filename.txt' } } },
    { event: 'step_update', step_update: { state: 'DONE', tool_name: 'view_file',
      tool_info: { parameters: { AbsolutePath: '/fixture/probe.txt' }, error: { message: 'file not found' } } } },
    { event: 'result', result: { status: 'SUCCESS', response: 'partial' } },
  ];
  const result = parseAntigravityResult(complete(events.map(JSON.stringify).join('\n')));
  assert.equal(result.toolEvidence.length, 1);
  assert.equal(result.toolEvidence[0].tool, 'run_command');
  assert.match(result.toolEvidence[0].commandHash, /^[a-f0-9]{64}$/);
  assert.match(result.toolEvidence[0].cwdHash, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result.toolEvidence).includes('private-filename'));
  assert.equal(result.toolFailures.length, 1);
});

test('catalog discovery allows cold startup and caches only successful bounded observations', async () => {
  const requests = [];
  const capture = async (command, args, options) => {
    requests.push({ command, args, options });
    return complete('Fetching available models...\n\u001b[32mgemini-3.1-pro-high\u001b[0m Description\ngemini-3.8-flash-low Description\ngpt4 Description\n');
  };
  const discovery = discoverAntigravityModels({ command: 'agy-test', capture });
  const first = await discovery();
  assert.equal(first.status, 'AVAILABLE');
  assert.deepEqual(first.models, ['gemini-3.1-pro-high', 'gemini-3.8-flash-low', 'gpt4']);
  assert.ok(requests[0].options.timeoutSeconds >= 60);
  assert.equal((await discovery()).cached, true);
  assert.equal(requests.length, 1);
});

test('CLI command evidence uses session cwd only when no explicit override exists and records observed Git root', () => {
  const init = { event: 'init', init: { cwd: process.cwd() } };
  const tool = { event: 'step_update', step_update: { state: 'DONE', tool_name: 'run_command',
    tool_info: { parameters: { CommandLine: 'git rev-parse --show-toplevel' }, output: process.cwd() + '\n' } } };
  const parse = events => parseAntigravityResult(complete(events.map(JSON.stringify).join('\n') + '\n' + final({ status: 'SUCCESS', response: 'done' })));
  const evidence = parse([init, tool]).toolEvidence[0];
  assert.equal(evidence.cwdHash, toolPathHash(process.cwd()));
  assert.equal(evidence.cwdSource, 'session');
  assert.equal(evidence.gitRootHash, toolPathHash(process.cwd()));
  assert.equal(parse([tool]).toolEvidence[0].cwdHash, undefined, 'no implicit cwd without session evidence');
  for (const Cwd of ['', 'relative/path']) {
    const overridden = structuredClone(tool);
    overridden.step_update.tool_info.parameters.Cwd = Cwd;
    assert.equal(parse([init, overridden]).toolEvidence[0].cwdHash, undefined, 'invalid explicit cwd cannot fall back');
  }
  assert.throws(() => parse([init, init, tool]), /session|init/i);
  assert.throws(() => parse([tool, init]), /session|init/i);
});

test('permission diagnostics remain actionable even when AGY exits unsuccessfully', () => {
  assert.throws(() => parseAntigravityResult(complete('', { code: 1, stderr: 'command permission denied' })),
    /blocked by a required permission/);
});

test('catalog timeouts stay distinct from invalid model selection and are not cached', async () => {
  let calls = 0;
  const discovery = discoverAntigravityModels({ command: 'agy-test', capture: async () => {
    calls++;
    return complete('', { code: null, timedOut: true });
  } });
  const result = await discovery();
  assert.equal(result.status, 'TIMEOUT');
  assert.match(result.error, /discovery.*timed out/i);
  assert.deepEqual(result.models, []);
  await discovery();
  assert.equal(calls, 2);
});

test('version discovery shares concurrent probes and reports timeout rather than missing CLI', async () => {
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const discover = discoverAntigravityVersion({ command: 'fixture', capture: async (_command, args, options) => {
    calls++;
    assert.deepEqual(args, ['--version']);
    assert.equal(options.timeoutSeconds, 30);
    await gate;
    return complete('1.4.4');
  } });
  const first = discover(), second = discover();
  release();
  assert.deepEqual(await first, await second);
  assert.equal(calls, 1);
  assert.equal((await discover()).cached, true);
  let failures = 0;
  const timeout = discoverAntigravityVersion({ command: 'fixture', capture: async () => {
    failures++;
    return complete('1.4.4', { timedOut: true, durationMs: 30001 });
  } });
  assert.equal((await timeout()).status, 'TIMEOUT');
  assert.equal((await timeout()).version, null);
  assert.equal(failures, 2);
});

test('incomplete version and catalog observations never become available', async () => {
  for (const flags of [{ cancelled: true }, { stdoutTruncated: true }, { stderrTruncated: true }, { code: 1 }]) {
    const capture = async () => complete('1.4.4', flags);
    assert.equal((await discoverAntigravityVersion({ command: 'fixture', capture })()).status, 'UNAVAILABLE');
    assert.equal((await discoverAntigravityModels({ command: 'fixture', capture })()).status, 'UNAVAILABLE');
  }
});

test('catalog discovery coalesces concurrent requests without changing the exact model', async () => {
  let calls = 0;
  const discover = discoverAntigravityModels({ command: 'fixture', capture: async () => {
    calls++;
    return complete('gemini-fixture-high Description');
  } });
  const results = await Promise.all([discover(), discover(), discover()]);
  assert.equal(calls, 1);
  assert.deepEqual(results.map(r => r.models), Array(3).fill(['gemini-fixture-high']));
});

test('MCP completion evidence records safe names only and never hides a soft denial', () => {
  const event = { event: 'step_update', step_update: { state: 'DONE', tool_name: 'call_mcp_tool',
    tool_info: { parameters: { ServerName: 'headroom', ToolName: 'headroom_stats', Arguments: { private: 'withheld' } }, output: 'private output' } } };
  const parse = e => parseAntigravityResult(complete(JSON.stringify(e) + '\n' + final({ status: 'SUCCESS', response: 'done' })));
  assert.deepEqual(parse(event).toolEvidence, [{ tool: 'call_mcp_tool', server: 'headroom', mcpTool: 'headroom_stats' }]);
  const externalized = structuredClone(event);
  delete externalized.step_update.tool_info.output;
  assert.deepEqual(parse(externalized).toolEvidence, parse(event).toolEvidence);
  const unsafe = structuredClone(event);
  unsafe.step_update.tool_info.parameters.ServerName = '/private/path';
  assert.deepEqual(parse(unsafe).toolEvidence, []);
  const failed = structuredClone(event);
  failed.step_update.tool_info.error = { message: 'Input validation error' };
  assert.deepEqual(parse(failed).toolEvidence, []);
  assert.equal(parse(failed).toolFailures.length, 1);
  failed.step_update.tool_info.error = { message: 'MCP call soft-denied' };
  assert.throws(() => parse(failed), /soft-denied/);
});
