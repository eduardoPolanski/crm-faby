import { env } from '../config/env.js';
import { logger } from '../logger.js';
import { supabase } from '../supabase/client.js';
import { processOutbound } from '../processors/outbound.js';
import type { WhatsAppConnection } from '../whatsapp/connection.js';

export function startOutboundRealtime(connection: WhatsAppConnection) {
  supabase.channel('worker-' + env.WHATSAPP_OWNER_ID)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'outbound_messages', filter: 'owner_id=eq.' + env.WHATSAPP_OWNER_ID }, (payload) => processOutbound(payload.new, () => connection.currentSocket))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_sessions', filter: 'owner_id=eq.' + env.WHATSAPP_OWNER_ID }, (payload) => {
      const previous = payload.old.qr_requested_at;
      const current = payload.new.qr_requested_at;
      if (current && current !== previous && payload.new.status !== 'connected') void connection.refreshQr();
    })
    .subscribe((status) => logger.info({ status }, 'outbound realtime subscription'));
}
