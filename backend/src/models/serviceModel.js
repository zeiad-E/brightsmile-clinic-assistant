import { UUID_PATTERN, unwrap } from './query.js';

/** Treatments the clinic offers (cleaning, filling, …) with duration and price. */

const COLUMNS =
  'id, slug, name_en, name_ar, description_en, description_ar, duration_minutes, price_egp, is_active, sort_order, created_at, updated_at';

export function listActive(db) {
  return unwrap(db.from('services').select(COLUMNS).eq('is_active', true).order('sort_order').order('name_en'));
}

export function listAll(db) {
  return unwrap(db.from('services').select(COLUMNS).order('sort_order').order('name_en'));
}

/** Accepts either the uuid or the slug ("teeth-cleaning"). */
export function findByIdOrSlug(db, key) {
  const column = UUID_PATTERN.test(key) ? 'id' : 'slug';
  return unwrap(db.from('services').select(COLUMNS).eq(column, key).maybeSingle());
}

export function create(db, row) {
  return unwrap(db.from('services').insert(row).select(COLUMNS).single());
}

export function update(db, id, patch) {
  return unwrap(db.from('services').update(patch).eq('id', id).select(COLUMNS).maybeSingle());
}
