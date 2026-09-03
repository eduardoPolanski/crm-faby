import { logger } from './logger.js';
import { startHealthServer } from './health/server.js';
import { startOutboundRealtime } from './queues/realtime.js';
import { WhatsAppConnection } from './whatsapp/connection.js';
import { upsertSession } from './supabase/repositories.js';

const connection = new WhatsAppConnection();
await upsertSession({ status: 'connecting', last_seen_at: new Date().toISOString() });
startHealthServer(connection);
startOutboundRealtime(connection);
await connection.start();
logger.info('Baileys worker started');

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  await upsertSession({ status: 'disconnected', disconnected_at: new Date().toISOString() });
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
