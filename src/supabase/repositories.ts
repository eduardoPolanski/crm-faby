import { supabase } from './client.js';
import { env } from '../config/env.js';

const owner = env.WHATSAPP_OWNER_ID;

export async function upsertSession(values: Record<string, unknown>) {
  const { error } = await supabase.from('whatsapp_sessions').upsert({
    owner_id: owner, session_name: env.WHATSAPP_SESSION_NAME, ...values,
  }, { onConflict: 'owner_id,session_name' });
  if (error) throw error;
}

export async function findOrCreateLead(phone: string, name?: string, pushName?: string) {
  const { data, error } = await supabase.from('leads').select('id').eq('owner_id', owner).eq('phone_e164', phone).maybeSingle();
  if (error) throw error;
  if (data) return data.id as string;
  const inserted = await supabase.from('leads').insert({ owner_id: owner, phone_e164: phone, name, push_name: pushName }).select('id').single();
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

export async function insertInboundMessage(input: {
  whatsappMessageId: string; remoteJid: string; conversationId: string; sender: string;
  text?: string; type: string; payload: unknown; createdAt: Date;
}) {
  const { error } = await supabase.from('messages').insert({
    owner_id: owner, conversation_id: input.conversationId, whatsapp_message_id: input.whatsappMessageId,
    remote_jid: input.remoteJid, direction: 'inbound', message_type: input.type,
    status: 'received', sender_phone_e164: input.sender, text_content: input.text,
    raw_payload: input.payload, created_at: input.createdAt.toISOString(),
  });
  if (error && error.code !== '23505') throw error;
  return !error;
}

export async function recoverPendingOutbound() {
  const { data, error } = await supabase.from('outbound_messages').select('*').eq('owner_id', owner)
    .eq('status', 'pending').lte('available_at', new Date().toISOString()).order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
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
  text?: string; whatsappMessageId: string;
}) {
  const result = await supabase.from('messages').insert({
    owner_id: owner, conversation_id: input.conversationId, whatsapp_message_id: input.whatsappMessageId,
    remote_jid: input.destinationJid, direction: 'outbound', message_type: input.type,
    status: 'sent', recipient_phone_e164: '+' + input.destinationJid.split('@')[0],
    text_content: input.text, sent_at: new Date().toISOString(), raw_payload: {},
  }).select('id').single();
  if (result.error && result.error.code !== '23505') throw result.error;
  await updateOutbound(input.outboundId, {
    message_id: result.data?.id ?? null, whatsapp_message_id: input.whatsappMessageId,
    status: 'sent', sent_at: new Date().toISOString(),
  });
}
