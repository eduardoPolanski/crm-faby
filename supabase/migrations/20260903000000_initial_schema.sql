create extension if not exists pgcrypto;
create schema if not exists private;

do $$ begin
  create type public.whatsapp_connection_status as enum ('connecting','qr_required','pairing_required','connected','disconnected','logged_out','error');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.message_direction as enum ('inbound','outbound');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.message_status as enum ('received','sent','delivered','read','failed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.outbound_message_status as enum ('pending','processing','sent','delivered','read','failed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.whatsapp_message_type as enum ('text','image','video','audio','document','sticker','location','contact','reaction','system','unknown');
exception when duplicate_object then null; end $$;

create or replace function private.set_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  phone_e164 text not null,
  name text,
  push_name text,
  email text,
  avatar_url text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_phone_e164_format check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint leads_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint leads_owner_phone_unique unique (owner_id, phone_e164)
);
create index if not exists leads_owner_updated_idx on public.leads (owner_id, updated_at desc);

create table if not exists public.whatsapp_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  session_name text not null default 'default',
  phone_e164 text,
  whatsapp_jid text,
  status public.whatsapp_connection_status not null default 'disconnected',
  qr_code text,
  pairing_code text,
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_seen_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sessions_phone_e164_format check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint sessions_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint sessions_owner_name_unique unique (owner_id, session_name)
);
create unique index if not exists whatsapp_sessions_owner_phone_idx on public.whatsapp_sessions (owner_id, phone_e164) where phone_e164 is not null;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  session_id uuid references public.whatsapp_sessions(id) on delete set null,
  channel text not null default 'whatsapp',
  remote_jid text not null,
  is_archived boolean not null default false,
  unread_count integer not null default 0,
  last_message_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_channel_check check (channel = 'whatsapp'),
  constraint conversations_unread_count_check check (unread_count >= 0),
  constraint conversations_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint conversations_owner_lead_unique unique (owner_id, lead_id)
);
create index if not exists conversations_owner_last_message_idx on public.conversations (owner_id, last_message_at desc nulls last);
create index if not exists conversations_owner_unread_idx on public.conversations (owner_id, unread_count desc) where unread_count > 0;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  whatsapp_message_id text,
  remote_jid text not null,
  direction public.message_direction not null,
  message_type public.whatsapp_message_type not null default 'unknown',
  status public.message_status not null default 'received',
  sender_phone_e164 text,
  recipient_phone_e164 text,
  text_content text,
  media_url text,
  media_mime_type text,
  media_sha256 text,
  quoted_whatsapp_message_id text,
  raw_payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint messages_raw_payload_object check (jsonb_typeof(raw_payload) = 'object'),
  constraint messages_sender_phone_format check (sender_phone_e164 is null or sender_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint messages_recipient_phone_format check (recipient_phone_e164 is null or recipient_phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);
create unique index if not exists messages_owner_whatsapp_id_idx on public.messages (owner_id, whatsapp_message_id) where whatsapp_message_id is not null;
create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at desc);
create index if not exists messages_owner_created_idx on public.messages (owner_id, created_at desc);

create table if not exists public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  session_id uuid references public.whatsapp_sessions(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  destination_jid text not null,
  message_type public.whatsapp_message_type not null default 'text',
  text_content text,
  media_url text,
  media_mime_type text,
  payload jsonb not null default '{}'::jsonb,
  status public.outbound_message_status not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  processing_started_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  whatsapp_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_attempts_check check (attempts >= 0),
  constraint outbound_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint outbound_content_check check (text_content is not null or media_url is not null or payload <> '{}'::jsonb)
);
create unique index if not exists outbound_owner_whatsapp_id_idx on public.outbound_messages (owner_id, whatsapp_message_id) where whatsapp_message_id is not null;
create index if not exists outbound_pending_idx on public.outbound_messages (status, available_at, created_at) where status = 'pending';
create index if not exists outbound_owner_created_idx on public.outbound_messages (owner_id, created_at desc);

create trigger leads_set_updated_at before update on public.leads for each row execute function private.set_updated_at();
create trigger whatsapp_sessions_set_updated_at before update on public.whatsapp_sessions for each row execute function private.set_updated_at();
create trigger conversations_set_updated_at before update on public.conversations for each row execute function private.set_updated_at();
create trigger messages_set_updated_at before update on public.messages for each row execute function private.set_updated_at();
create trigger outbound_messages_set_updated_at before update on public.outbound_messages for each row execute function private.set_updated_at();

create or replace function private.update_conversation_on_message()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  update public.conversations
  set last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at),
      unread_count = case when new.direction = 'inbound' and new.status <> 'read' then unread_count + 1 else unread_count end,
      updated_at = now()
  where id = new.conversation_id and owner_id = new.owner_id;
  return new;
end $$;
create trigger messages_update_conversation after insert on public.messages for each row execute function private.update_conversation_on_message();

alter table public.leads enable row level security;
alter table public.whatsapp_sessions enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.outbound_messages enable row level security;

create policy leads_select_own on public.leads for select to authenticated using (owner_id = auth.uid());
create policy leads_insert_own on public.leads for insert to authenticated with check (owner_id = auth.uid());
create policy leads_update_own on public.leads for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy leads_delete_own on public.leads for delete to authenticated using (owner_id = auth.uid());
create policy sessions_select_own on public.whatsapp_sessions for select to authenticated using (owner_id = auth.uid());
create policy conversations_select_own on public.conversations for select to authenticated using (owner_id = auth.uid());
create policy conversations_update_own on public.conversations for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy messages_select_own on public.messages for select to authenticated using (owner_id = auth.uid());
create policy outbound_select_own on public.outbound_messages for select to authenticated using (owner_id = auth.uid());
create policy outbound_insert_own on public.outbound_messages for insert to authenticated with check (owner_id = auth.uid());

alter table public.outbound_messages replica identity full;
alter table public.whatsapp_sessions replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'outbound_messages') then
    alter publication supabase_realtime add table public.outbound_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whatsapp_sessions') then
    alter publication supabase_realtime add table public.whatsapp_sessions;
  end if;
end $$;
