-- Guest chats that survive a return visit.
--
-- A visitor who chats without signing in gets an HttpOnly cookie holding a random secret
-- (backend/src/auth/visitorCookie.js). The conversation keeps only the secret's SHA-256 hash,
-- like sessions.refresh_hash, so reading this table gives nobody a usable key.
--
--  - Coming back: the backend finds the visitor's latest chat by this hash (GET /api/chat/current).
--  - Signing in, signing up or booking: every chat with this hash and no owner moves to the
--    patient (profile_id/patient_id set, visitor_hash cleared).
--
-- Only the backend's service role reads conversations, and the backend never sends this column
-- to a browser or the dashboard.

alter table public.conversations add column visitor_hash text;

create index conversations_visitor_idx on public.conversations (visitor_hash, last_message_at desc)
  where profile_id is null and visitor_hash is not null;
