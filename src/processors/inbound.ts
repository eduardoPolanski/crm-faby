import { downloadMediaMessage, getContentType, jidNormalizedUser, type Contact, type WASocket, type WAMessage } from '@whiskeysockets/baileys';
import { logger } from '../logger.js';
import { findOrCreateConversation, findOrCreateLead, insertMessageMedia, insertWhatsAppMessage } from '../supabase/repositories.js';

function phoneFromJid(jid: string) {
  const value = jid.split(':')[0].split('@')[0];
  return value ? '+' + value.replace(/^\+/, '') : '';
}

function timestampToDate(value: WAMessage['messageTimestamp']) {
  const seconds = typeof value === 'object' && value && 'toNumber' in value ? value.toNumber() : Number(value);
  return new Date((Number.isFinite(seconds) && seconds > 0 ? seconds : Date.now() / 1000) * 1000);
}

function getRemoteJid(message: WAMessage) {
  const key = message.key as typeof message.key & { remoteJidAlt?: string };
  return jidNormalizedUser(key.remoteJidAlt ?? key.senderPn ?? key.remoteJid ?? '');
}

function messageDetails(message: WAMessage) {
  const content = message.message;
  const contentType = content ? getContentType(content) : undefined;
  const value = contentType ? content?.[contentType] as Record<string, unknown> | undefined : undefined;
  const text = message.message?.conversation ?? message.message?.extendedTextMessage?.text
    ?? (typeof value?.caption === 'string' ? value.caption : undefined);
  const typeMap: Record<string, string> = {
    conversation: 'text', extendedTextMessage: 'text', imageMessage: 'image', videoMessage: 'video',
    audioMessage: 'audio', documentMessage: 'document', stickerMessage: 'sticker', locationMessage: 'location',
    contactMessage: 'contact', reactionMessage: 'reaction',
  };
  const mimeType = typeof value?.mimetype === 'string' ? value.mimetype : undefined;
  return { text, type: typeMap[contentType ?? ''] ?? 'unknown', mimeType };
}

async function saveMedia(message: WAMessage, messageId: string, type: string, mimeType: string | undefined, socket: WASocket) {
  if (!['image', 'video', 'audio', 'document', 'sticker'].includes(type)) return undefined;
  try {
    const data = await downloadMediaMessage(message, 'buffer', {}, { logger, reuploadRequest: socket.updateMediaMessage });
    const extension = mimeType?.split('/')[1]?.split(';')[0]?.replace(/[^a-z0-9]/gi, '') || 'bin';
    return await insertMessageMedia(messageId, data, mimeType ?? 'application/octet-stream', extension);
  } catch (error) {
    logger.warn({ err: error, messageId }, 'could not download whatsapp media');
    return undefined;
  }
}

export async function processMessages(messages: WAMessage[], socket: WASocket) {
  for (const message of messages) {
    try {
      const key = message.key;
      const remoteJid = getRemoteJid(message);
      if (!key.id || !remoteJid || remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast')) continue;
      const { text, type, mimeType } = messageDetails(message);
      const pushName = message.pushName ?? undefined;
      const phone = phoneFromJid(remoteJid);
      if (!phone) continue;
      const leadId = await findOrCreateLead(phone, pushName, pushName);
      const conversationId = await findOrCreateConversation(leadId, remoteJid);
      const mediaUrl = await saveMedia(message, key.id, type, mimeType, socket);
      const inserted = await insertWhatsAppMessage({
        whatsappMessageId: key.id, remoteJid, conversationId, direction: key.fromMe ? 'outbound' : 'inbound',
        phone, text, type, mimeType, mediaUrl, payload: message, createdAt: timestampToDate(message.messageTimestamp),
      });
      logger.info({ messageId: key.id, inserted, direction: key.fromMe ? 'outbound' : 'inbound' }, 'whatsapp message processed');
    } catch (error) {
      logger.error({ err: error }, 'failed to process inbound message');
    }
  }
}

export async function processContacts(contacts: Partial<Contact>[], socket?: WASocket) {
  for (const contact of contacts) {
    try {
      if (!contact.id || !contact.id.endsWith('@s.whatsapp.net')) continue;
      const phone = phoneFromJid(jidNormalizedUser(contact.id));
      if (!phone) continue;
      let avatarUrl = (contact as { imgUrl?: string | null }).imgUrl;
      if (!avatarUrl && socket) {
        try { avatarUrl = await socket.profilePictureUrl(jidNormalizedUser(contact.id), 'image'); } catch { /* contacts without a photo are expected */ }
      }
      const leadId = await findOrCreateLead(phone, contact.name ?? undefined, contact.notify ?? contact.verifiedName ?? undefined, avatarUrl);
      await findOrCreateConversation(leadId, jidNormalizedUser(contact.id));
    } catch (error) {
      logger.error({ err: error, contactId: contact.id }, 'failed to process contact');
    }
  }
  logger.info({ count: contacts.length }, 'whatsapp contacts processed');
}
