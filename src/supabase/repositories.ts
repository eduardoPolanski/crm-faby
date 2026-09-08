import { supabase } from './client.js';
import { env } from '../config/env.js';

const owner = env.WHATSAPP_OWNER_ID;

export async function upsertSession(values: Record<string, unknown>) {
  const { error } = await supabase.from('whatsapp_sessions').upsert({
    owner_id: owner, session_name: env.WHATSAPP_SESSION_NAME, ...values,
  }, { onConflict: 'owner_id,session_name' });
  if (error) throw error;
}

export async function findOrCreateLead(phone: string, name?: string, pushName?: string, avatarUrl?: string | null) {
  const { data, error } = await supabase.from('leads').select('id').eq('owner_id', owner).eq('phone_e164', phone).maybeSingle();
  if (error) throw error;
  if (data) {
    if (name || pushName || avatarUrl) {
      const { error: updateError } = await supabase.from('leads').update({
        ...(name ? { name } : {}),
        ...(pushName ? { push_name: pushName } : {}),
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
      }).eq('id', data.id);
      if (updateError) throw updateError;
    }
    return data.id as string;
  }
  const inserted = await supabase.from('leads').insert({ owner_id: owner, phone_e164: phone, name, push_name: pushName, avatar_url: avatarUrl }).select('id').single();
  if (inserted.error && inserted.error.code !== '23505') throw inserted.error;
  if (inserted.data) return inserted.data.id as string;
  const retry = await supabase.from('leads').select('id').eq('owner_id', owner).eq('phone_e164', phone).single();
  if (retry.error) throw retry.error;
  return retry.data.id as string;
}

export async function findOrCreateConversation(leadId: string, remoteJid: string) {
  const { data, error } = await supabase.from('conversations').select('id').eq('owner_id', owner).eq('lead_id', leadId).maybeSingle();
  if (error) throw error;
  if (data) return data.id as string;
  const inserted = await supabase.from('conversations').insert({ owner_id: owner, lead_id: leadId, remote_jid: remoteJid }).select('id').single();
  if (inserted.error && inserted.error.code !== '23505') throw inserted.error;
  if (inserted.data) return inserted.data.id as string;
  const retry = await supabase.from('conversations').select('id').eq('owner_id', owner).eq('lead_id', leadId).single();
  if (retry.error) throw retry.error;
  return retry.data.id as string;
}

export async function insertWhatsAppMessage(input: {
  whatsappMessageId: string; remoteJid: string; conversationId: string; direction: 'inbound' | 'outbound'; phone: string;
  text?: string; type: string; mimeType?: string; mediaUrl?: string; payload: unknown; createdAt: Date;
}) {
  const { error } = await supabase.from('messages').insert({
    owner_id: owner, conversation_id: input.conversationId, whatsapp_message_id: input.whatsappMessageId,
    remote_jid: input.remoteJid, direction: input.direction, message_type: input.type,
    status: input.direction === 'inbound' ? 'received' : 'sent',
    ...(input.direction === 'inbound' ? { sender_phone_e164: input.phone } : { recipient_phone_e164: input.phone, sent_at: input.createdAt.toISOString() }),
    text_content: input.text, media_url: input.mediaUrl, media_mime_type: input.mimeType,
    raw_payload: input.payload, created_at: input.createdAt.toISOString(),
  });
  if (error && error.code !== '23505') throw error;
  return !error;
}

export async function insertMessageMedia(messageId: string, data: Buffer, contentType: string, extension: string) {
  const path = `${owner}/${messageId}.${extension}`;
  const { error } = await supabase.storage.from('whatsapp-media').upload(path, data, { contentType, upsert: false });
  if (error && !/already exists/i.test(error.message)) throw error;
  return path;
}

export async function recoverPendingOutbound() {
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const stale = await supabase.from('outbound_messages').update({ status: 'pending', processing_started_at: null })
    .eq('owner_id', owner).eq('status', 'processing').lt('processing_started_at', staleBefore);
  if (stale.error) throw stale.error;
  const { data, error } = await supabase.from('outbound_messages').select('*').eq('owner_id', owner)
    .eq('status', 'pending').lte('available_at', new Date().toISOString()).order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function downloadOutboundMedia(path: string) {
  const { data, error } = await supabase.storage.from('whatsapp-media').download(path);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}

export async function claimOutbound(id: string) {
  const { data, error } = await supabase.from('outbound_messages').update({
    status: 'processing', processing_started_at: new Date().toISOString(),
  }).eq('id', id).eq('status', 'pending').select('*').maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateOutbound(id: string, values: Record<string, unknown>) {
  const { error } = await supabase.from('outbound_messages').update(values).eq('id', id);
  if (error) throw error;
}

export async function updateMessageStatus(whatsappMessageId: string, status: 'sent' | 'delivered' | 'read' | 'failed') {
  const now = new Date().toISOString();
  const values: Record<string, unknown> = { status, updated_at: now };
  if (status === 'sent') values.sent_at = now;
  if (status === 'delivered') values.delivered_at = now;
  if (status === 'read') values.read_at = now;
  if (status === 'failed') values.failed_at = now;
  const message = await supabase.from('messages').update(values).eq('owner_id', owner).eq('whatsapp_message_id', whatsappMessageId);
  if (message.error) throw message.error;
  const outbound = await supabase.from('outbound_messages').update({ ...values, status }).eq('owner_id', owner).eq('whatsapp_message_id', whatsappMessageId);
  if (outbound.error) throw outbound.error;
}

export async function createOutboundMessageRecord(input: {
  outboundId: string; conversationId: string; destinationJid: string; type: string;
  text?: string; mediaUrl?: string | null; mediaMimeType?: string | null; whatsappMessageId: string;
}) {
  const result = await supabase.from('messages').insert({
    owner_id: owner, conversation_id: input.conversationId, whatsapp_message_id: input.whatsappMessageId,
    remote_jid: input.destinationJid, direction: 'outbound', message_type: input.type,
    status: 'sent', recipient_phone_e164: '+' + input.destinationJid.split('@')[0],
    text_content: input.text, media_url: input.mediaUrl, media_mime_type: input.mediaMimeType,
    sent_at: new Date().toISOString(), raw_payload: {},
  }).select('id').single();
  if (result.error && result.error.code !== '23505') throw result.error;
  await updateOutbound(input.outboundId, {
    message_id: result.data?.id ?? null, whatsapp_message_id: input.whatsappMessageId,
    status: 'sent', sent_at: new Date().toISOString(),
  });
}
