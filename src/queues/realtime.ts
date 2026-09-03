import { env } from '../config/env.js';
import { logger } from '../logger.js';
import { supabase } from '../supabase/client.js';
import { processOutbound } from '../processors/outbound.js';
import type { WhatsAppConnection } from '../whatsapp/connection.js';

export function startOutboundRealtime(connection: WhatsAppConnection) {
  supabase.channel('outbound-' + env.WHATSAPP_OWNER_ID)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'outbound_messages', filter: 'owner_id=eq.' + env.WHATSAPP_OWNER_ID }, (payload) => processOutbound(payload.new, () => connection.currentSocket))
    .subscribe((status) => logger.info({ status }, 'outbound realtime subscription'));
}
