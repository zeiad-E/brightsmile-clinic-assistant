import { adminAs, requireAdmin } from '../db/supabase.js';
import { llmClient } from '../llm/LlmClient.js';
import * as conversationModel from '../models/conversationModel.js';
import * as jobModel from '../models/jobModel.js';
import * as memoryModel from '../models/memoryModel.js';
import * as messageModel from '../models/messageModel.js';
import * as patientModel from '../models/patientModel.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { normalizeText } from '../utils/text.js';
import { listView } from '../views/listView.js';
import { LIMITS } from '../agent/guardrails.js';

/**
 * The assistant's memory, in three layers (so it remembers without burning tokens):
 *  1. short-term: the last few messages + a rolling summary of older ones (per conversation)
 *  2. notes about the patient: short preferences the agent writes ("prefers mornings")
 *  3. past conversations: a summary + embedding per finished chat, recalled on demand
 * Summaries and clean-ups run as background jobs, never slowing down a reply.
 */

export const MEMORY_LIMITS = Object.freeze({ softCap: 15, hardCap: 20, idleMinutes: 30, rollingEvery: 5 });

const DIALOGUE_HEAD = (m) => `${m.role === 'user' ? 'Patient' : 'Assistant'}: ${m.content}`;

async function summarize(messages, { words, focus }) {
  const res = await llmClient.chat({
    temperature: 0.1,
    maxTokens: 300,
    messages: [
      {
        role: 'system',
        content: `You write private notes for a dental clinic's receptionist. Summarise the chat below in at most ${words} words, in English. ${focus} Keep placeholders like [EMAIL_1] out of the summary. No medical details beyond the treatment name. Output only the summary.`,
      },
      { role: 'user', content: messages.map(DIALOGUE_HEAD).join('\n').slice(0, 12_000) },
    ],
  });
  return String(res.choices?.[0]?.message?.content ?? '').trim();
}

// ---------- layer 1: rolling summary inside a long conversation ----------

export async function summarizeOlderMessages({ conversationId }) {
  const db = requireAdmin();
  const messages = await messageModel.listForConversation(db, conversationId);
  const older = messages.slice(0, -LIMITS.historyMessages);
  if (!older.length) return;
  const summary = await summarize(older, {
    words: 80,
    focus: 'Capture what the patient wants, what was decided or booked, and details still pending.',
  });
  if (summary) await conversationModel.update(db, conversationId, { summary });
}

// ---------- layer 3: final summary + embedding, when the chat goes quiet ----------

export async function finalizeConversation({ conversationId }) {
  const db = requireAdmin();
  const conversation = await conversationModel.findById(db, conversationId);
  if (!conversation) return;
  const idleSince = Date.now() - new Date(conversation.last_message_at).getTime();
  if (idleSince < MEMORY_LIMITS.idleMinutes * 60_000) return; // still active; a later job will run

  const messages = await messageModel.listForConversation(db, conversationId);
  if (messages.length < 2) return;
  const summary = await summarize(messages, {
    words: 100,
    focus: 'Capture the date-independent facts: what they asked, what was booked/changed/escalated, and their preferences.',
  });
  if (!summary) return;

  const patch = { summary, summarized_at: new Date().toISOString() };
  if (conversation.patient_id) {
    const [embedding] = await llmClient.embed([summary]);
    patch.summary_embedding = JSON.stringify(embedding);
  }
  await conversationModel.update(db, conversationId, patch);

  if (conversation.patient_id) {
    const notes = await memoryModel.listForPatient(db, conversation.patient_id, MEMORY_LIMITS.hardCap + 5);
    if (notes.filter((n) => n.source === 'agent').length > MEMORY_LIMITS.softCap) {
      await jobModel.enqueue(db, { type: 'consolidate_memories', payload: { patientId: conversation.patient_id } });
    }
  }
}

/** After each saved turn: keep the summaries up to date (as background jobs). */
export async function scheduleSummaries(conversation, turnCount) {
  const db = requireAdmin();
  const jobs = [
    jobModel.enqueueOrDelay(db, {
      type: 'finalize_conversation',
      key: conversation.id,
      payload: { conversationId: conversation.id },
      runAt: new Date(Date.now() + MEMORY_LIMITS.idleMinutes * 60_000 + 60_000),
    }),
  ];
  // Messages beyond the short-term window need summarising every few turns.
  if (turnCount * 2 > LIMITS.historyMessages && turnCount % MEMORY_LIMITS.rollingEvery === 0) {
    jobs.push(jobModel.enqueue(db, { type: 'summarize_conversation', payload: { conversationId: conversation.id } }));
  }
  await Promise.all(jobs);
}

// ---------- layer 3: recall ----------

export async function recall({ patientId, currentConversationId, question }) {
  const [embedding] = await llmClient.embed([question]);
  const matches = await conversationModel.matchSummaries(requireAdmin(), { patientId, embedding, limit: 2 });
  return matches
    .filter((m) => m.conversation_id !== currentConversationId)
    .slice(0, 2)
    .map((m) => ({ date: String(m.last_message_at).slice(0, 10), summary: m.summary }));
}

// ---------- layer 2: notes about the patient ----------

const KINDS = ['preference', 'communication_style', 'logistics'];

// Notes must be kind, practical and non-sensitive: no health data, no contact details, no insults.
const SENSITIVE = [
  /allerg|diabet|pregnan|medicat|medicine|pills?\b|antibiotic|blood\s*pressure|heart|asthma|hiv|hepatitis|cancer|surgery|disease|diagnos|infection|symptom|mental|depress|anxiety\s+disorder/i,
  /religio|political|sexual|ethnic/i,
  /حساسي|سكري|مريض\s*سكر|حامل|حمل|دواء|أدوية|ادوية|مضاد\s*حيوي|ضغط\s*الدم|القلب|ربو|سرطان|عملية\s*جراحية|مرض|التهاب|اكتئاب/,
];
const JUDGEMENTAL = [/\b(rude|stupid|idiot|dumb|annoying|liar|crazy|lazy|ugly|cheap)\b/i, /وقح|غبي|رخم|قليل\s*الأدب|مزعج|كذاب|بخيل/];
const CONTACT = [/\[(EMAIL|PHONE|DOB|CODE)_\d+\]/, /@/, /\d{6,}/];

export function checkNote(content) {
  const text = String(content ?? '').trim();
  if (text.length < 3 || text.length > 200) return 'Notes must be 3–200 characters.';
  if (CONTACT.some((p) => p.test(text))) return 'Notes must not contain contact details, dates of birth or codes.';
  if (SENSITIVE.some((p) => p.test(text))) return 'Notes must not contain health or other sensitive information.';
  if (JUDGEMENTAL.some((p) => p.test(text))) return 'Phrase it kindly as a preference (e.g. "prefers short replies"), never as a judgement.';
  return null;
}

/** The agent saves a note. Very similar notes are updated instead of duplicated. */
export async function remember({ patientId, conversationId, kind, content }) {
  if (!KINDS.includes(kind)) return { error: 'invalid_kind', message: `kind must be one of ${KINDS.join(', ')}` };
  const problem = checkNote(content);
  if (problem) return { error: 'note_rejected', message: problem };

  const db = adminAs(null, 'patient_assistant');
  const existing = await memoryModel.listForPatient(requireAdmin(), patientId, MEMORY_LIMITS.hardCap + 5);
  const normalized = normalizeText(content);
  const words = new Set(normalized.split(' ').filter((w) => w.length > 3));
  const similar = existing.find((note) => {
    const other = normalizeText(note.content);
    if (other === normalized) return true;
    const shared = other.split(' ').filter((w) => w.length > 3 && words.has(w)).length;
    return note.kind === kind && words.size > 0 && shared / words.size >= 0.6;
  });

  if (similar) {
    if (similar.source === 'owner') return { saved: false, note: 'The owner already set a note about this; keep following it.' };
    await memoryModel.update(db, similar.id, { content: content.trim(), conversation_id: conversationId });
    return { saved: true, updated: true };
  }
  if (existing.length >= MEMORY_LIMITS.hardCap) {
    await jobModel.enqueue(requireAdmin(), { type: 'consolidate_memories', payload: { patientId } });
    return { saved: false, note: 'Memory is full for now; it will be tidied up shortly.' };
  }
  await memoryModel.insert(db, { patient_id: patientId, kind, content: content.trim(), source: 'agent', conversation_id: conversationId });
  if (existing.length + 1 > MEMORY_LIMITS.softCap) {
    await jobModel.enqueue(requireAdmin(), { type: 'consolidate_memories', payload: { patientId } });
  }
  return { saved: true };
}

/** Background job: merge a long list of agent notes into a short, non-repeating one. Owner notes are never touched. */
export async function consolidateMemories({ patientId }) {
  const admin = requireAdmin();
  const notes = await memoryModel.listForPatient(admin, patientId, 50);
  const agentNotes = notes.filter((n) => n.source === 'agent');
  if (agentNotes.length <= MEMORY_LIMITS.softCap - 3) return;

  const res = await llmClient.chat({
    temperature: 0,
    maxTokens: 600,
    messages: [
      {
        role: 'system',
        content:
          'Merge these notes about a dental clinic patient into at most 12 short, non-repeating notes. Keep the newest information when notes conflict. Output ONLY a JSON array of {"kind": "preference"|"communication_style"|"logistics", "content": "..."} with content under 200 characters.',
      },
      { role: 'user', content: JSON.stringify(agentNotes.map(({ kind, content }) => ({ kind, content }))) },
    ],
  });
  const text = res.choices?.[0]?.message?.content ?? '';
  let merged;
  try {
    merged = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
  } catch {
    throw new Error('Consolidation returned invalid JSON');
  }
  const valid = merged.filter((n) => KINDS.includes(n?.kind) && !checkNote(n?.content)).slice(0, 12);
  if (!valid.length) throw new Error('Consolidation produced no valid notes');

  const db = adminAs(null, 'system');
  await memoryModel.removeForPatient(db, patientId, { source: 'agent' });
  for (const note of valid) {
    await memoryModel.insert(db, { patient_id: patientId, kind: note.kind, content: note.content.trim(), source: 'agent' });
  }
  logger.info(`Consolidated ${agentNotes.length} notes into ${valid.length} for patient ${patientId}`);
}

// ---------- privacy: "forget me" ----------

/** Deletes the patient's notes and conversations (except ones with an open escalation, and `keepConversationId`). */
export async function forgetPatient({ patientId, keepConversationId = null }) {
  if (!patientId) throw AppError.notFound('no_patient_record', 'This login has no patient record.');
  const db = requireAdmin();
  await memoryModel.removeForPatient(adminAs(null, 'patient_assistant'), patientId);
  const ids = (await conversationModel.deletableForPatient(db, patientId)).filter((id) => id !== keepConversationId);
  const deleted = await conversationModel.removeMany(db, ids);
  if (keepConversationId) await conversationModel.update(db, keepConversationId, { summary: null, summary_embedding: null });
  return { memories_deleted: true, conversations_deleted: deleted };
}

// ---------- owner screens ----------

/** The owner's list, each note with its patient's name. */
export async function listForOwner({ db }, filters) {
  const page = await memoryModel.listAll(db, filters);
  const names = await patientModel.namesByIds(db, page.rows.map((row) => row.patient_id));
  return listView(page, filters, (row) => ({ ...row, patient_name: names.get(row.patient_id) ?? null }));
}

export async function createByOwner({ db }, { patient_id: patientId, kind, content }) {
  const problem = checkNote(content);
  if (problem) throw AppError.badRequest('note_rejected', problem);
  return memoryModel.insert(db, { patient_id: patientId, kind, content: content.trim(), source: 'owner' });
}

export async function updateByOwner({ db }, id, patch) {
  if (patch.content) {
    const problem = checkNote(patch.content);
    if (problem) throw AppError.badRequest('note_rejected', problem);
  }
  const note = await memoryModel.update(db, id, { ...patch, source: 'owner' });
  if (!note) throw AppError.notFound('memory_not_found', 'Note not found.');
  return note;
}

export async function removeByOwner({ db }, id) {
  if (!(await memoryModel.remove(db, id))) throw AppError.notFound('memory_not_found', 'Note not found.');
}
