alter table public.leads
  add column if not exists temperature text not null default 'cold',
  add column if not exists stage text not null default 'new',
  add column if not exists tags text[] not null default '{}',
  add column if not exists next_action text,
  add column if not exists next_action_at timestamptz,
  add column if not exists last_contact_at timestamptz,
  add column if not exists last_inbound_at timestamptz,
  add column if not exists last_outbound_at timestamptz;

alter table public.leads
  drop constraint if exists leads_temperature_check;
alter table public.leads
  add constraint leads_temperature_check
  check (temperature in ('cold', 'warm', 'hot'));

alter table public.leads
  drop constraint if exists leads_stage_check;
alter table public.leads
  add constraint leads_stage_check
  check (stage in ('new', 'contacted', 'interested', 'scheduled', 'completed', 'lost'));

create index if not exists leads_owner_temperature_idx
  on public.leads (owner_id, temperature, updated_at desc);

create index if not exists leads_follow_up_idx
  on public.leads (owner_id, next_action_at)
  where next_action_at is not null;

create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  title text not null,
  notes text,
  due_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists follow_ups_owner_due_idx
  on public.follow_ups (owner_id, due_at)
  where completed_at is null;

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 50,
  status text not null default 'scheduled',
  reminder_sent_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_duration_check check (duration_minutes between 15 and 240),
  constraint appointments_status_check check (status in ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'))
);

create index if not exists appointments_owner_scheduled_idx
  on public.appointments (owner_id, scheduled_at);

create index if not exists appointments_lead_idx
  on public.appointments (lead_id, scheduled_at desc);

create trigger follow_ups_set_updated_at
before update on public.follow_ups
for each row execute function private.set_updated_at();

create trigger appointments_set_updated_at
before update on public.appointments
for each row execute function private.set_updated_at();

alter table public.follow_ups enable row level security;
alter table public.appointments enable row level security;

drop policy if exists follow_ups_select_own on public.follow_ups;
create policy follow_ups_select_own on public.follow_ups for select to authenticated
using (owner_id = auth.uid());

drop policy if exists follow_ups_insert_own on public.follow_ups;
create policy follow_ups_insert_own on public.follow_ups for insert to authenticated
with check (owner_id = auth.uid());

drop policy if exists follow_ups_update_own on public.follow_ups;
create policy follow_ups_update_own on public.follow_ups for update to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists follow_ups_delete_own on public.follow_ups;
create policy follow_ups_delete_own on public.follow_ups for delete to authenticated
using (owner_id = auth.uid());

drop policy if exists appointments_select_own on public.appointments;
create policy appointments_select_own on public.appointments for select to authenticated
using (owner_id = auth.uid());

drop policy if exists appointments_insert_own on public.appointments;
create policy appointments_insert_own on public.appointments for insert to authenticated
with check (owner_id = auth.uid());

drop policy if exists appointments_update_own on public.appointments;
create policy appointments_update_own on public.appointments for update to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists appointments_delete_own on public.appointments;
create policy appointments_delete_own on public.appointments for delete to authenticated
using (owner_id = auth.uid());

do $$
declare
  table_name text;
begin
  foreach table_name in array array['leads', 'conversations', 'messages', 'follow_ups', 'appointments'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;
