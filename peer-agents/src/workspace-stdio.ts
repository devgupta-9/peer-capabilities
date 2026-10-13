import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

/** We fetch roots on EVERY authorization request, so roots-changed notifications
 * carry no state we need. Some modern hosts send this legacy notification between
 * server/discover and the first request. SDK 2.0.0 otherwise treats it as a legacy
 * fallback and loses the modern capability exchange. Discard only this hint;
 * never discard requests, root responses, cancellation, or revocation results. */
export class WorkspaceStdioTransport extends StdioServerTransport {
  override async start(): Promise<void> {
    const receive = this.onmessage;
    this.onmessage = message => {
      if (!('id' in message) && 'method' in message && message.method === 'notifications/roots/list_changed') return;
      receive?.(message);
    };
    await super.start();
  }
}
