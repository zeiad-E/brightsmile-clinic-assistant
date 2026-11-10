-- A handover follows its chat to the patient.
--
-- A handover (escalations row) copies the chat's patient when the assistant creates it. A guest
-- who signs in later, in the chat or on the website, moves the CHAT to their account
-- (conversations.patient_id), but the handover kept its empty copy. So the Inbox still said
-- "Visitor (not signed in)", and "forget me" (which keeps chats with an open handover, found by
-- the handover's patient) could delete a chat that staff still had to answer.
--
-- The backend gives a chat its patient in three places (chatService runTurn, the chat's sign-in
-- tool, conversationModel.claimForPatient). A trigger covers all of them, and any added later.

create function public.sync_escalation_patient()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only fills an empty copy: a handover that already names a patient keeps it.
  update public.escalations
  set patient_id = new.patient_id
  where conversation_id = new.id
    and patient_id is null;
  return null;
end;
$$;

create trigger conversations_sync_escalation_patient
  after update of patient_id on public.conversations
  for each row
  when (new.patient_id is not null and old.patient_id is distinct from new.patient_id)
  execute function public.sync_escalation_patient();

-- One-time repair of handovers made before this trigger existed.
update public.escalations e
set patient_id = c.patient_id
from public.conversations c
where c.id = e.conversation_id
  and e.patient_id is null
  and c.patient_id is not null;
