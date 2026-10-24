import { parseArgs } from 'node:util';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import * as z from 'zod/v4';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { EnvironmentManager } from './environment.js';
import { ProviderAdapter, adapterConfigSchema } from './adapters.js';
import { TaskStore } from './store.js';
import { Runtime } from './runner.js';
import { stateDirectory, repositoryRoot } from './repository.js';
import { createTaskServer } from './host.js';
import { assertNonSecret, redact } from '../security.js';
import { defaultEnvironmentDirectory } from './environment-state.js';
import { WorkspaceAuthorizer } from '../path-policy.js';
import { PACKAGE_VERSION } from '../version.js';
import { selectTaskTools } from '../tool-selection.js';
import { registerTaskToolSelector } from '../tool-selection-host.js';
import { McpServer } from '@modelcontextprotocol/server';

const configSchema = z.object({
  agents: z.array(adapterConfigSchema),
  policy: z.object({
    policyVersion: z.string().min(1), manifestDigest: z.string().min(1),
    mode: z.enum(['FAST', 'STANDARD']), competence: z.number().min(0).max(10),
    complexity: z.enum(['low', 'medium', 'high']), testCommand: z.array(z.string().min(1)).min(1),
    exact: z.object({ agent: z.string(), model: z.string(), effort: z.string() }).optional(),
    optionalIntegrations: z.record(z.string(), z.boolean()).optional(),
  }).strict(),
}).strict();
const json = async (file: string) => JSON.parse(await readFile(path.resolve(file), 'utf8'));
const print = (value: unknown) => console.log(redact(JSON.stringify(value, null, 2)));
export async function main(argv: string[]): Promise<void> {
  const { values: v, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    help: { type: 'boolean' }, apply: { type: 'boolean' }, 'checkpoint-only': { type: 'boolean' },
    manifest: { type: 'string' }, root: { type: 'string' }, 'state-dir': { type: 'string' },
    config: { type: 'string' }, repo: { type: 'string' }, objective: { type: 'string' }, id: { type: 'string' }, input: { type: 'string' },
  } });
  const command = positionals[0] ?? 'help';
  if (v.help || command === 'help') {
    console.log('Tool selection: tools select --objective TEXT | --input FILE; tools mcp (host-neutral local stdio). Selection is advice, never execution or permission.');
    console.log('Projects: project add <absolute-root> | remove <absolute-root> | list | check <absolute-path>\nEnrollment is explicit additional trust, not required for a host-reported active Git workspace.');
    console.log('Peer Capabilities (development; not release-certified)\nCommands: setup doctor update sync repair rollback uninstall version discover verify run resume status mcp\nEnvironment: --manifest FILE --root DIRECTORY [--state-dir DIRECTORY] [--apply]\nTasks: --repo REPOSITORY --config FILE [--objective TEXT] [--id UUID] [--checkpoint-only]\nsetup/update/sync/repair preview changes unless --apply. CLI/MCP integration is disabled pending trusted host approval. Inspect the verified patch for deliberate manual integration. No npm postinstall mutations.');
    return;
  }
  if (command === 'version') { print({ version: PACKAGE_VERSION, node: process.versions.node, maturity: 'development', releaseSupported: false }); return; }
  if (command === 'integrate') {
    console.error('Integration is disabled on this surface: a terminal is not proof of human approval. Inspect the verified patch and integrate through an approved host workflow.');
    process.exitCode = 1; return;
  }
  const depth = Number(process.env.PEER_AGENTS_DEPTH ?? 0);
  if (!Number.isSafeInteger(depth) || depth !== 0) throw new Error('Recursive runtime invocation prohibited');
  if (command === 'tools') {
    if (positionals[1] === 'mcp') {
      await serveStdio(() => {
        const server = new McpServer({ name: 'peer-capabilities-tools', version: PACKAGE_VERSION });
        registerTaskToolSelector(server); return server;
      }); return;
    }
    if (positionals[1] !== 'select' || Boolean(v.input) === Boolean(v.objective)) throw new Error('tools select requires exactly one of --objective or --input');
    print(selectTaskTools(v.input ? await json(v.input) : { objective: v.objective })); return;
  }
  if (command === 'project') {
    const action = positionals[1], target = positionals[2];
    const policy = new WorkspaceAuthorizer();
    if (action === 'list') { print({ projects: policy.registry.list() }); return; }
    if (!target || !path.isAbsolute(target)) throw new Error('project add/remove/check requires an absolute project path');
    if (action === 'add') { await policy.enroll(target); print({ enrolled: true }); return; }
    if (action === 'remove') { print({ removed: policy.remove(target) }); return; }
    if (action === 'check') { const decision = await policy.check(target); print(decision); if (!decision.ready) process.exitCode = 1; return; }
    throw new Error('Unknown project command; use add, remove, list or check');
  }
  if (['setup', 'doctor', 'update', 'sync', 'repair', 'rollback', 'uninstall'].includes(command)) {
    if (!v.root) throw new Error('--root is required; no implicit home-directory installation');
    const root = path.resolve(v.root);
    await mkdir(root, { recursive: true });
    const stateRoot = path.resolve(v['state-dir'] ?? defaultEnvironmentDirectory(root));
    const manager = new EnvironmentManager(path.join(stateRoot, 'environment.sqlite'), root);
    try {
      if (command === 'uninstall') {
        if (!v.apply) throw new Error('uninstall requires explicit --apply');
        print({ operation: await manager.uninstall() }); return;
      }
      if (command === 'rollback') {
        if (!v.apply || !v.id) throw new Error('rollback requires --apply --id');
        print({ operation: await manager.rollback(v.id) }); return;
      }
      if (!v.manifest) throw new Error('--manifest is required');
      const manifest = await json(v.manifest);
      if (command === 'doctor') { print({ components: await manager.doctor(manifest), releaseSupported: false }); return; }
      const plan = await manager.plan(manifest, command as 'setup' | 'sync' | 'repair' | 'update');
      if (v.apply) await manager.apply(plan.id);
      print({ operation: plan.id, changes: plan.operations.map(o => ({ id: o.id, destination: o.destination })), applied: Boolean(v.apply) });
    } finally { manager.close(); }
    return;
  }
  if (!v.config || !v.repo) throw new Error('Task commands require --config and --repo');
  const raw = await json(v.config); assertNonSecret(raw);
  const config = configSchema.parse(raw);
  const root = await repositoryRoot(path.resolve(v.repo));
  const environmentPath = path.join(path.resolve(v['state-dir'] ?? defaultEnvironmentDirectory(root)), 'environment.sqlite');
  const environment = new EnvironmentManager(environmentPath, root);
  let store: TaskStore | undefined;
  let serving = false;
  try {
    const adapters = config.agents.map(c => new ProviderAdapter(c, environment.getObservation(c.id), undefined, environment));
    if (command === 'discover' || command === 'verify') {
      const results = [];
      for (const adapter of adapters) {
        if (command === 'verify') {
          const observation = await adapter.verify(root);
          environment.recordObservation(observation); results.push(observation);
        } else {
          const result = await adapter.discover(); environment.recordObservation(result.observation); results.push(result);
        }
      }
      print({ agents: results, releaseSupported: false });
      return;
    }
    const taskStore = new TaskStore(path.join(await stateDirectory(root), 'tasks.sqlite'));
    store = taskStore;
    const runtime = new Runtime(taskStore, adapters, config.policy);
    if (command === 'mcp') {
      await serveStdio(() => createTaskServer(runtime, taskStore, root, config.policy.optionalIntegrations));
      serving = true; return; // Both databases remain live for the stdio server lifetime.
    }
    if (command === 'run') {
      if (!v.objective) throw new Error('--objective is required');
      print(await runtime.start(root, v.objective, v['checkpoint-only'])); return;
    }
    if (!v.id) throw new Error('--id is required');
    if (command === 'resume') { print(await runtime.resume(v.id)); return; }
    if (command === 'status') { print(runtime.report(v.id)); return; }
    throw new Error('Unknown command');
  } finally { if (!serving) { store?.close(); environment.close(); } }
}
