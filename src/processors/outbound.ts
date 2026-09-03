import type { WASocket } from '@whiskeysockets/baileys';
import { logger } from '../logger.js';
import { claimOutbound, createOutboundMessageRecord, recoverPendingOutbound, updateOutbound } from '../supabase/repositories.js';

type Outbound = Record<string, any>;
let running = false;

export async function sendOutbound(row: Outbound, socket: WASocket) {
  if (running) return;
  const claimed = await claimOutbound(row.id);
  if (!claimed) return;
  running = true;
  try {
    const content = claimed.message_type === 'text' ? { text: claimed.text_content ?? '' } : claimed.payload;
    const result = await socket.sendMessage(claimed.destination_jid, content);
    const whatsappId = result?.key?.id;
    if (!whatsappId) throw new Error('Baileys did not return a message ID');
    await createOutboundMessageRecord({
      outboundId: claimed.id, conversationId: claimed.conversation_id,
      destinationJid: claimed.destination_jid, type: claimed.message_type,
      text: claimed.text_content, whatsappMessageId: whatsappId,
    });
  } catch (error) {
    await updateOutbound(claimed.id, { status: 'failed', failed_at: new Date().toISOString(), error_message: error instanceof Error ? error.message : String(error) });
    logger.error({ err: error, outboundId: claimed.id }, 'outbound message failed');
  } finally {
    running = false;
  }
}

export async function recoverOutbound(getSocket: () => WASocket | undefined) {
  const rows = await recoverPendingOutbound();
  const socket = getSocket();
  if (!socket) return;
  for (const row of rows) await sendOutbound(row, socket);
  logger.info({ count: rows.length }, 'pending outbound messages recovered');
}

export function processOutbound(row: Outbound, getSocket: () => WASocket | undefined) {
  const socket = getSocket();
  if (socket) void sendOutbound(row, socket);
}
