-- Private media bucket. Files are scoped to the authenticated owner's UUID folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('whatsapp-media', 'whatsapp-media', false, 52428800, null)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists whatsapp_media_select_own on storage.objects;
create policy whatsapp_media_select_own on storage.objects for select to authenticated
using (bucket_id = 'whatsapp-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists whatsapp_media_insert_own on storage.objects;
create policy whatsapp_media_insert_own on storage.objects for insert to authenticated
with check (bucket_id = 'whatsapp-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists whatsapp_media_update_own on storage.objects;
create policy whatsapp_media_update_own on storage.objects for update to authenticated
using (bucket_id = 'whatsapp-media' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'whatsapp-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists whatsapp_media_delete_own on storage.objects;
create policy whatsapp_media_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'whatsapp-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- The realtime event is the worker's wake-up signal. Keeping the full row avoids
-- losing the message identifier after an UPDATE.
alter table public.outbound_messages replica identity full;
