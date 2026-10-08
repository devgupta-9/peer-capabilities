import { inputRequired, type McpServer, type ServerContext, type ClientCapabilities } from '@modelcontextprotocol/server';
import { fileURLToPath } from 'node:url';
import * as z from 'zod/v4';

const rootsSchema = z.object({ roots: z.array(z.object({ uri: z.string() })).max(64) });
/** Host protocol input, not model-visible tool parameters. The SDK translates
 * inputRequired to roots/list on legacy connections and MRTR on modern ones. */
export function hostWorkspaceRoots(server: McpServer, ctx: ServerContext) {
  const envelope = ctx.mcpReq.envelope;
  const capabilities = (envelope as Record<string, unknown> | undefined)?.['io.modelcontextprotocol/clientCapabilities'] as ClientCapabilities | undefined
    ?? server.server.getClientCapabilities();
  if (!capabilities?.roots) return { roots: undefined };
  const response = ctx.mcpReq.inputResponses?.workspaceRoots;
  if (response === undefined) return { request: inputRequired({ inputRequests: { workspaceRoots: inputRequired.listRoots() } }) };
  // Invalid or refused roots fail closed; never restore startup trust on errors.
  const parsed = rootsSchema.safeParse(response);
  if (!parsed.success) throw new Error('Host returned invalid workspace roots');
  return { roots: parsed.data.roots.map(root => {
    const uri = new URL(root.uri);
    if (uri.protocol !== 'file:' || uri.hostname || uri.search || uri.hash) throw new Error('Host root must be a local file URI');
    return fileURLToPath(uri);
  }) };
}
