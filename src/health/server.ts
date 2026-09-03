import { createServer } from 'node:http';
import { env } from '../config/env.js';
import type { WhatsAppConnection } from '../whatsapp/connection.js';

export function startHealthServer(connection: WhatsAppConnection) {
  const server = createServer((_request, response) => {
    response.writeHead(connection.isConnected ? 200 : 503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: connection.isConnected, whatsapp: connection.isConnected ? 'connected' : 'disconnected' }));
  });
  server.listen(env.PORT, '127.0.0.1');
}
