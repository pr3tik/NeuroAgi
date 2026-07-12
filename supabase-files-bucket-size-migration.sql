-- supabase-files-bucket-size-migration.sql
-- Raises the course-files bucket's per-object size limit from 25MB to 100MB.
--
-- The original supabase-files-storage-migration.sql's `insert ... on conflict (id)
-- do update set public = false` does NOT update file_size_limit on conflict, so
-- re-running that file would not change an already-existing bucket's limit —
-- this migration does the update explicitly instead.
--
-- Run once in the Supabase SQL editor.

update storage.buckets
set file_size_limit = 104857600  -- 100 * 1024 * 1024
where id = 'course-files';
