import { pageRange, searchTerm, unwrap, unwrapPage } from './query.js';

/**
 * The clinic's knowledge base: one document per topic and language (group_key links the
 * English and Arabic versions). The assistant answers from these.
 */
const LIST_COLUMNS =
  'id, group_key, language, category, title, source_type, file_name, mime_type, ingest_status, ingest_error, is_published, created_at, updated_at';
const FULL_COLUMNS = `${LIST_COLUMNS}, content, file_path, created_by`;

export function list(db, { language, category, status, q, limit, offset }) {
  let query = db.from('knowledge_docs').select(LIST_COLUMNS, { count: 'exact' }).order('group_key').order('language');
  if (language) query = query.eq('language', language);
  if (category) query = query.eq('category', category);
  if (status) query = query.eq('ingest_status', status);
  const term = q ? searchTerm(q) : '';
  if (term) query = query.or(`title.ilike.%${term}%,group_key.ilike.%${term}%`);
  return unwrapPage(query.range(...pageRange({ limit, offset })));
}

export function findById(db, id) {
  return unwrap(db.from('knowledge_docs').select(FULL_COLUMNS).eq('id', id).maybeSingle());
}

export function create(db, row) {
  return unwrap(db.from('knowledge_docs').insert(row).select(FULL_COLUMNS).single());
}

export function update(db, id, patch) {
  return unwrap(db.from('knowledge_docs').update(patch).eq('id', id).select(FULL_COLUMNS).maybeSingle());
}

export async function remove(db, id) {
  const rows = await unwrap(db.from('knowledge_docs').delete().eq('id', id).select('id'));
  return rows.length > 0;
}

export async function chunkCount(db, docId) {
  const { count, error } = await db.from('knowledge_chunks').select('id', { count: 'exact', head: true }).eq('doc_id', docId);
  if (error) throw error;
  return count ?? 0;
}
