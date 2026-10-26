import { unwrap } from './query.js';

/** The owner's intake questions for new patients (insurance, city, how they heard about us…). */

const COLUMNS = 'id, key, label_en, label_ar, kind, options, required, sort_order, is_active, updated_at';

export function listActive(db) {
  return unwrap(db.from('intake_fields').select(COLUMNS).eq('is_active', true).order('sort_order'));
}

export function listAll(db) {
  return unwrap(db.from('intake_fields').select(COLUMNS).order('sort_order'));
}

export function create(db, row) {
  return unwrap(db.from('intake_fields').insert(row).select(COLUMNS).single());
}

export function update(db, id, patch) {
  return unwrap(db.from('intake_fields').update(patch).eq('id', id).select(COLUMNS).maybeSingle());
}

export async function remove(db, id) {
  const rows = await unwrap(db.from('intake_fields').delete().eq('id', id).select('id'));
  return rows.length > 0;
}
