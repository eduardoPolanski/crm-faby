alter table public.whatsapp_sessions
  add column if not exists qr_requested_at timestamptz;

drop policy if exists sessions_update_own on public.whatsapp_sessions;
create policy sessions_update_own
on public.whatsapp_sessions for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create or replace function public.request_whatsapp_qr()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.whatsapp_sessions
  set qr_requested_at = now(),
      qr_code = null,
      status = 'connecting',
      last_error = null
  where owner_id = auth.uid()
    and session_name = 'default';
end;
$$;

grant execute on function public.request_whatsapp_qr() to authenticated;
