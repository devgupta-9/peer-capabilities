import { McpServer } from '@modelcontextprotocol/server';
import { taskToolInputSchema, selectTaskTools } from './tool-selection.js';

export function registerTaskToolSelector(server: McpServer, enabled: Readonly<Record<string, boolean>> = {}): void {
  server.registerTool('select_task_tools', {
    description: 'Select optional local tools for the current task. Returns recommendations and prerequisites only; never executes tools, verifies readiness or grants permissions. Explicit needs override conservative English intent inference.',
    inputSchema: taskToolInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, input => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(selectTaskTools(input, enabled)) }] }; }
    catch { return { isError: true, content: [{ type: 'text' as const, text: 'Tool selection rejected; provide a bounded non-secret task description.' }] }; }
  });
}
