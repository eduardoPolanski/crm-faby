import { jidNormalizedUser, type WAMessage } from '@whiskeysockets/baileys';
import { logger } from '../logger.js';
import { findOrCreateConversation, findOrCreateLead, insertInboundMessage } from '../supabase/repositories.js';

function phoneFromJid(jid: string) {
  const value = jid.split(':')[0].split('@')[0];
  return value ? '+' + value.replace(/^\+/, '') : '';
}

export async function processInbound(messages: WAMessage[]) {
  for (const message of messages) {
    try {
      const key = message.key;
      if (!key.id || key.fromMe || !key.remoteJid || key.remoteJid.endsWith('@g.us')) continue;
      const remoteJid = jidNormalizedUser(key.remoteJid);
      const text = message.message?.conversation ?? message.message?.extendedTextMessage?.text ?? undefined;
      const pushName = message.pushName ?? undefined;
      const type = text ? 'text' : 'unknown';
      const phone = phoneFromJid(remoteJid);
      if (!phone) continue;
      const leadId = await findOrCreateLead(phone, pushName, pushName);
      const conversationId = await findOrCreateConversation(leadId, remoteJid);
      const inserted = await insertInboundMessage({
        whatsappMessageId: key.id, remoteJid, conversationId, sender: phone,
        text, type, payload: message, createdAt: new Date(Number(message.messageTimestamp ?? Date.now() / 1000) * 1000),
      });
      logger.info({ messageId: key.id, inserted }, 'inbound message processed');
    } catch (error) {
      logger.error({ err: error }, 'failed to process inbound message');
    }
  }
}
