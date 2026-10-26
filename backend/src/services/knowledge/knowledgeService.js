import crypto from 'node:crypto';
import { requireAdmin } from '../../db/supabase.js';
import * as knowledgeModel from '../../models/knowledgeModel.js';
import * as knowledgeGapModel from '../../models/knowledgeGapModel.js';
import * as jobModel from '../../models/jobModel.js';
import { ingestDoc } from '../../rag/ingest.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { listView } from '../../views/listView.js';
import { detectKind, extractText, KINDS, MAX_FILE_BYTES } from './extract.js';

/**
 * The owner's knowledge base: what the assistant knows.
 *
 * Every change is saved as "pending" and then processed in the background (extract text →
 * split into chunks → embed → "ready"), so the owner never waits and a failure shows up
 * as a clear status ("failed" + reason) instead of a broken request.
 */
const BUCKET = 'knowledge-files';

async function queueIngest(docId, { extract = false } = {}) {
  await jobModel.enqueue(requireAdmin(), { type: 'ingest_knowledge', payload: { docId, extract }, maxAttempts: 3 });
}

const conflict = (err) => {
  if (err?.code === '23505') {
    return AppError.conflict('group_language_taken', 'This topic already has a document in this language. Edit that one instead.');
  }
  return err;
};

export async function list({ db }, filters) {
  return listView(await knowledgeModel.list(db, filters), filters);
}

export async function get({ db }, id) {
  const doc = await knowledgeModel.findById(db, id);
  if (!doc) throw AppError.notFound('knowledge_not_found', 'Document not found.');
  return { ...doc, chunks: await knowledgeModel.chunkCount(requireAdmin(), id) };
}

/** A document typed in by the owner. */
export async function create({ user, db }, input) {
  let doc;
  try {
    doc = await knowledgeModel.create(db, { ...input, source_type: 'manual', ingest_status: 'pending', created_by: user.id });
  } catch (err) {
    throw conflict(err);
  }
  await queueIngest(doc.id);
  return doc;
}

/** Edits; a new title or text means the document is re-embedded. */
export async function update({ db }, id, patch) {
  const needsIngest = patch.title !== undefined || patch.content !== undefined;
  let doc;
  try {
    doc = await knowledgeModel.update(db, id, needsIngest ? { ...patch, ingest_status: 'pending', ingest_error: null } : patch);
  } catch (err) {
    throw conflict(err);
  }
  if (!doc) throw AppError.notFound('knowledge_not_found', 'Document not found.');
  if (needsIngest) await queueIngest(id);
  return doc;
}

export async function remove({ db }, id) {
  const doc = await knowledgeModel.findById(db, id);
  if (!doc) throw AppError.notFound('knowledge_not_found', 'Document not found.');
  await knowledgeModel.remove(db, id); // its chunks go with it
  if (doc.file_path) {
    const { error } = await requireAdmin().storage.from(BUCKET).remove([doc.file_path]);
    if (error) logger.warn(`Stored file not removed (${doc.file_path}): ${error.message}`);
  }
}

export async function reingest({ db }, id) {
  const doc = await knowledgeModel.findById(db, id);
  if (!doc) throw AppError.notFound('knowledge_not_found', 'Document not found.');
  await knowledgeModel.update(db, id, { ingest_status: 'pending', ingest_error: null });
  await queueIngest(id, { extract: doc.source_type === 'upload' });
  return { queued: true };
}

const safeFileName = (name) =>
  String(name ?? 'file')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-100);

/** An uploaded PDF / Word / text file. The file is stored privately; its text is read in the background. */
export async function upload({ user, db }, file, fields) {
  if (!file) throw AppError.badRequest('file_required', 'Attach a PDF, Word (.docx), .txt or .md file.');
  if (file.size > MAX_FILE_BYTES) throw new AppError(413, 'file_too_large', 'Files can be up to 10 MB.');
  const kind = detectKind(file.originalname, file.buffer);
  if (!kind) throw new AppError(422, 'unsupported_file', 'Only PDF, Word (.docx), .txt and .md files are supported.');

  const id = crypto.randomUUID();
  const fileName = safeFileName(file.originalname);
  const path = `${id}/${fileName}`;
  const storage = requireAdmin().storage.from(BUCKET);
  const { error: uploadError } = await storage.upload(path, file.buffer, { contentType: KINDS[kind].mime, upsert: false });
  if (uploadError) throw uploadError;

  let doc;
  try {
    doc = await knowledgeModel.create(db, {
      id,
      group_key: fields.group_key,
      language: fields.language,
      category: fields.category,
      title: fields.title || fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
      content: '',
      source_type: 'upload',
      file_path: path,
      file_name: file.originalname.slice(0, 200),
      mime_type: KINDS[kind].mime,
      is_published: fields.is_published ?? true,
      ingest_status: 'pending',
      created_by: user.id,
    });
  } catch (err) {
    await storage.remove([path]).catch(() => {});
    throw conflict(err);
  }
  await queueIngest(id, { extract: true });
  return doc;
}

/**
 * Background job: (for uploads) download the file and read its text, then chunk + embed.
 * The document's status ends as "ready" or "failed" with a reason the owner can read.
 */
export async function ingestJob({ docId, extract }) {
  const admin = requireAdmin();
  const doc = await knowledgeModel.findById(admin, docId);
  if (!doc) return;

  if (doc.source_type === 'upload' && (extract || !doc.content)) {
    const { data, error } = await admin.storage.from(BUCKET).download(doc.file_path);
    if (error) throw error;
    const bytes = Buffer.from(await data.arrayBuffer());
    const kind = detectKind(doc.file_name, bytes);
    let text = '';
    try {
      text = kind ? await extractText(kind, bytes) : '';
    } catch (err) {
      await knowledgeModel.update(admin, docId, { ingest_status: 'failed', ingest_error: err.message.slice(0, 500) });
      return;
    }
    if (text.length < 20) {
      await knowledgeModel.update(admin, docId, {
        ingest_status: 'failed',
        ingest_error: 'No readable text found. Scanned PDFs (pictures of pages) are not supported yet — upload a text PDF or a Word file.',
      });
      return;
    }
    doc.content = text;
    await knowledgeModel.update(admin, docId, { content: text });
  }

  const result = await ingestDoc(doc);
  if (!result.ok) logger.warn(`Knowledge doc ${docId} failed to ingest: ${result.error}`);
}

// ---------- knowledge gaps ----------

export async function listGaps({ db }, filters) {
  return listView(await knowledgeGapModel.list(db, filters), filters);
}

export async function setGapStatus({ db }, id, status) {
  const gap = await knowledgeGapModel.setStatus(db, id, status);
  if (!gap) throw AppError.notFound('gap_not_found', 'Question not found.');
  return gap;
}
