import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { redact } from '../security.js';
import { Runtime } from './runner.js';
import { TaskStore } from './store.js';

export function createTaskServer(runtime: Runtime, store: TaskStore, repository: string): McpServer {
  const server = new McpServer({ name: 'peer-capabilities', version: '0.4.0-dev.0' });
  const reply = (value: unknown, isError = false) => ({
    content: [{ type: 'text' as const, text: redact(JSON.stringify(value)) }], ...(isError ? { isError: true } : {}),
  });
  const guard = async (action: () => unknown | Promise<unknown>) => {
    try { return reply(await action()); } catch { return reply({ error: 'Task operation rejected; inspect local task status. No implicit retry.' }, true); }
  };
  const idSchema = z.object({ id: z.string().uuid() }).strict();
  server.registerTool('v1_task_create', { description: 'Create durable task state in the server-configured repository; does not run an agent.', inputSchema: z.object({ objective: z.string().min(1).max(24000) }).strict() },
    ({ objective }) => guard(() => runtime.create(repository, objective)));
  server.registerTool('v1_task_status', { description: 'Read validated canonical state and evidence-based outcome summary.', inputSchema: idSchema },
    ({ id }) => guard(() => runtime.report(id)));
  server.registerTool('v1_task_context', { description: 'Read canonical task state and events; agent-specific packages are constructed during dispatch.', inputSchema: idSchema },
    ({ id }) => guard(() => ({ state: store.get(id), events: store.events(id) })));
  server.registerTool('v1_task_dispatch', { description: 'Dispatch a created task under the server-configured exact policy; never integrates the patch.', inputSchema: idSchema },
    ({ id }) => guard(() => runtime.dispatch(id)));
  server.registerTool('v1_task_resume', { description: 'Resume a safe durable checkpoint; never approves or integrates.', inputSchema: idSchema },
    ({ id }) => guard(() => runtime.resume(id)));
  return server;
}
