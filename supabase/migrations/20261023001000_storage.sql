-- Private storage bucket for uploaded knowledge files (PDF, DOCX, TXT, MD).
-- Owner uploads/manages; the backend reads with the service role to extract text.
-- Skipped automatically where Supabase Storage isn't installed (local test database).

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not found; skipping knowledge-files bucket';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'knowledge-files',
    'knowledge-files',
    false,
    10485760,  -- 10 MB
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown'
    ]
  )
  on conflict (id) do nothing;

  execute $policy$
    create policy knowledge_files_owner_all on storage.objects
      for all to authenticated
      using (bucket_id = 'knowledge-files' and (select public.is_owner()))
      with check (bucket_id = 'knowledge-files' and (select public.is_owner()))
  $policy$;
end;
$$;
