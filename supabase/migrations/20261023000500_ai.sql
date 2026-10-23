-- AI: conversations of both assistants, messages, run logs, audit log, knowledge base.

create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  assistant       public.assistant_kind not null,
  profile_id      uuid references public.profiles (id) on delete set null,  -- who is chatting (null = not identified yet)
  patient_id      uuid references public.patients (id) on delete set null,
  language        public.lang not null default 'en',
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index conversations_profile_idx on public.conversations (profile_id, last_message_at desc);
create index conversations_assistant_idx on public.conversations (assistant, last_message_at desc);

alter table public.escalations
  add constraint escalations_conversation_fk
  foreign key (conversation_id) references public.conversations (id) on delete set null;

create table public.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role            public.message_role not null,
  content         text not null default '',
  tool_name       text,
  tool_payload    jsonb,
  created_at      timestamptz not null default now()
);

create index messages_conversation_idx on public.messages (conversation_id, id);

-- One row per assistant turn: powers the owner's stats.
create table public.agent_runs (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations (id) on delete set null,
  assistant       public.assistant_kind not null,
  model           text,
  latency_ms      integer check (latency_ms >= 0),
  iterations      integer check (iterations >= 0),
  tool_calls      jsonb not null default '[]'::jsonb,
  outcome         public.run_outcome not null,
  created_at      timestamptz not null default now()
);

create index agent_runs_created_idx on public.agent_runs (created_at desc);

-- Every change to clinic data, by a person or by the staff assistant (before/after → undo).
create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles (id) on delete set null,
  via        text not null check (via in ('staff_assistant', 'patient_assistant', 'dashboard', 'system')),
  action     text not null,
  entity     text not null,
  entity_id  text,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);

-- Clinic knowledge, typed in or uploaded as a file (EN and AR versions share a group_key).
create table public.knowledge_docs (
  id            uuid primary key default gen_random_uuid(),
  group_key     text not null check (group_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  language      public.lang not null,
  category      text not null check (category in ('services', 'pricing', 'hours', 'insurance', 'policies', 'prep', 'location', 'faq', 'other')),
  title         text not null,
  content       text not null default '',
  source_type   text not null default 'manual' check (source_type in ('manual', 'upload')),
  file_path     text,
  file_name     text,
  mime_type     text check (mime_type is null or mime_type in (
                  'application/pdf',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  'text/plain',
                  'text/markdown')),
  ingest_status public.ingest_status not null default 'pending',
  ingest_error  text,
  is_published  boolean not null default true,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint knowledge_docs_group_language_key unique (group_key, language),
  constraint knowledge_docs_upload_has_file check (source_type = 'manual' or file_path is not null)
);

create trigger knowledge_docs_set_updated_at
  before update on public.knowledge_docs
  for each row execute function public.set_updated_at();

-- Searchable pieces of the docs; written only by the backend.
create table public.knowledge_chunks (
  id          uuid primary key default gen_random_uuid(),
  doc_id      uuid not null references public.knowledge_docs (id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content     text not null,
  embedding   extensions.vector(768) not null,
  created_at  timestamptz not null default now(),
  constraint knowledge_chunks_doc_index_key unique (doc_id, chunk_index)
);

create index knowledge_chunks_embedding_idx
  on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);
