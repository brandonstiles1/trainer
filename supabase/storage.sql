-- ============================================
-- Supabase Storage setup for the trainer app.
-- Creates one bucket: "photos"
-- Path convention: {user_id}/{kind}/{yyyy-mm-dd}-{uuid}.{ext}
-- ============================================

-- Create the bucket (idempotent)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos',
  'photos',
  false,                    -- private bucket; access via signed URLs only
  10485760,                 -- 10 MB limit per file
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

-- ---------- RLS ----------

drop policy if exists "photos: user reads own objects" on storage.objects;
create policy "photos: user reads own objects"
  on storage.objects for select
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "photos: user writes own objects" on storage.objects;
create policy "photos: user writes own objects"
  on storage.objects for insert
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "photos: user deletes own objects" on storage.objects;
create policy "photos: user deletes own objects"
  on storage.objects for delete
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
