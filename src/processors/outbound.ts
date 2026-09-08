import type { WASocket } from '@whiskeysockets/baileys';
import { logger } from '../logger.js';
import { claimOutbound, createOutboundMessageRecord, downloadOutboundMedia, recoverPendingOutbound, updateOutbound } from '../supabase/repositories.js';

type Outbound = Record<string, any>;
let draining = false;
let drainRequested = false;

async function outboundContent(row: Outbound) {
  if (row.message_type === 'text') return { text: row.text_content ?? '' };
  if (!row.media_url) return row.payload;
  const media = await downloadOutboundMedia(row.media_url);
  const caption = row.text_content || undefined;
  if (row.message_type === 'image') return { image: media, caption, mimetype: row.media_mime_type || undefined };
  if (row.message_type === 'video') return { video: media, caption, mimetype: row.media_mime_type || undefined };
  if (row.message_type === 'audio') return { audio: media, mimetype: row.media_mime_type || undefined, ptt: false };
  if (row.message_type === 'document') return { document: media, caption, mimetype: row.media_mime_type || undefined, fileName: row.payload?.fileName || 'arquivo' };
  return row.payload;
}

export async function sendOutbound(row: Outbound, socket: WASocket) {
  const claimed = await claimOutbound(row.id);
  if (!claimed) return;
  try {
    const content = await outboundContent(claimed);
    const result = await socket.sendMessage(claimed.destination_jid, content);
    const whatsappId = result?.key?.id;
    if (!whatsappId) throw new Error('Baileys did not return a message ID');
    await createOutboundMessageRecord({
      outboundId: claimed.id, conversationId: claimed.conversation_id,
      destinationJid: claimed.destination_jid, type: claimed.message_type,
      text: claimed.text_content, mediaUrl: claimed.media_url, mediaMimeType: claimed.media_mime_type, whatsappMessageId: whatsappId,
    });
  } catch (error) {
    await updateOutbound(claimed.id, { status: 'failed', failed_at: new Date().toISOString(), error_message: error instanceof Error ? error.message : String(error) });
    logger.error({ err: error, outboundId: claimed.id }, 'outbound message failed');
  } finally { /* claim state is finalized above */ }
}

export async function recoverOutbound(getSocket: () => WASocket | undefined) {
  if (draining) { drainRequested = true; return; }
  draining = true;
  try {
    do {
      drainRequested = false;
      const rows = await recoverPendingOutbound();
      const socket = getSocket();
      if (!socket) return;
      for (const row of rows) await sendOutbound(row, socket);
      logger.info({ count: rows.length }, 'pending outbound messages recovered');
    } while (drainRequested);
  } finally { draining = false; }
}

export function processOutbound(row: Outbound, getSocket: () => WASocket | undefined) {
  drainRequested = true;
  void recoverOutbound(getSocket);
}
