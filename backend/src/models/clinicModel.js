import { unwrap } from './query.js';

/** The single clinic_settings row (id = 1). */

export function getSettings(db) {
  return unwrap(db.from('clinic_settings').select('*').eq('id', 1).single());
}

export function updateSettings(db, patch) {
  return unwrap(db.from('clinic_settings').update(patch).eq('id', 1).select('*').maybeSingle());
}
