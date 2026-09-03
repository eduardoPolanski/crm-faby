import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, proto, useMultiFileAuthState, type WASocket } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { env } from '../config/env.js';
import { logger } from '../logger.js';
import { updateMessageStatus, upsertSession } from '../supabase/repositories.js';
import { processContacts, processInbound } from '../processors/inbound.js';
import { recoverOutbound } from '../processors/outbound.js';

export class WhatsAppConnection {
  private socket?: WASocket;
  private reconnecting = false;
  private refreshingQr = false;
  async start(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(env.WHATSAPP_AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    this.socket = makeWASocket({ version, auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) }, browser: Browsers.ubuntu('Chrome'), generateHighQualityLinkPreview: false, markOnlineOnConnect: false, syncFullHistory: false, logger });
    this.socket.ev.on('creds.update', saveCreds);
    this.socket.ev.on('connection.update', (update) => void this.handleConnection(update));
    this.socket.ev.on('messages.upsert', (event) => void processInbound(event.messages));
    this.socket.ev.on('contacts.upsert', (contacts) => void processContacts(contacts));
    this.socket.ev.on('contacts.update', (contacts) => void processContacts(contacts));
    this.socket.ev.on('messages.update', (updates) => void this.handleMessageUpdates(updates));
    await recoverOutbound(() => this.socket);
  }

  async refreshQr(): Promise<void> {
    if (this.isConnected || this.refreshingQr) return;
    this.refreshingQr = true;
    logger.info('refreshing whatsapp qr');
    this.socket?.end(new Error('QR refresh requested'));
    this.socket = undefined;
    setTimeout(() => {
      this.refreshingQr = false;
      void this.start().catch((error) => logger.error({ err: error }, 'qr refresh failed'));
    }, 500);
  }

  private async handleMessageUpdates(updates: Array<{ key: { id?: string | null }; update?: { status?: proto.WebMessageInfo.Status | null } }>) {
    for (const item of updates) {
      if (!item.key.id || item.update?.status == null) continue;
      const statusMap: Partial<Record<proto.WebMessageInfo.Status, 'sent' | 'delivered' | 'read' | 'failed'>> = {
        [proto.WebMessageInfo.Status.SERVER_ACK]: 'sent',
        [proto.WebMessageInfo.Status.DELIVERY_ACK]: 'delivered',
        [proto.WebMessageInfo.Status.READ]: 'read',
        [proto.WebMessageInfo.Status.PLAYED]: 'read',
        [proto.WebMessageInfo.Status.ERROR]: 'failed',
      };
      const status = statusMap[item.update.status];
      if (status) await updateMessageStatus(item.key.id, status);
    }
  }
  private async handleConnection(update: { connection?: 'open' | 'close' | 'connecting'; qr?: string; lastDisconnect?: { error?: unknown } }) {
    if (update.qr) await upsertSession({ status: 'qr_required', qr_code: await QRCode.toDataURL(update.qr), last_seen_at: new Date().toISOString(), last_error: null });
    if (update.connection === 'open') {
      this.reconnecting = false;
      const jid = this.socket?.user?.id;
      if (!jid) {
        await upsertSession({
          status: 'qr_required',
          last_seen_at: new Date().toISOString(),
          last_error: null,
        });
        logger.warn('whatsapp transport opened before authentication');
        return;
      }
      await upsertSession({ status: 'connected', qr_code: null, pairing_code: null, connected_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), last_error: null, phone_e164: jid ? '+' + jid.split(':')[0].split('@')[0] : null, whatsapp_jid: jid });
      logger.info('whatsapp connected');
      await recoverOutbound(() => this.socket);
      this.refreshingQr = false;
    }
    if (update.connection === 'close') {
      const statusCode = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      await upsertSession({ status: loggedOut ? 'logged_out' : 'disconnected', disconnected_at: new Date().toISOString(), last_error: String(update.lastDisconnect?.error ?? 'unknown') });
      if (!loggedOut && !this.reconnecting) {
        this.reconnecting = true;
        setTimeout(() => void this.start().catch((error) => logger.error({ err: error }, 'reconnect failed')), 5000);
      }
    }
  }
  get isConnected() { return this.socket?.user != null; }
  get currentSocket() { return this.socket; }
}
