import { pageRange, unwrapPage, unwrap } from './query.js';

/** Days or hours a doctor (or, with staff_id = null, the whole clinic) is unavailable. */

const COLUMNS = 'id, staff_id, starts_at, ends_at, reason, created_by, created_at, updated_at';

export function list(db, { from, to, staffId, limit, offset }) {
  let query = db.from('time_off').select(COLUMNS, { count: 'exact' }).order('starts_at');
  if (from) query = query.gte('ends_at', from);
  if (to) query = query.lte('starts_at', to);
  if (staffId === null) query = query.is('staff_id', null);
  else if (staffId) query = query.or(`staff_id.eq.${staffId},staff_id.is.null`);
  return unwrapPage(query.range(...pageRange({ limit, offset })));
}

export function findById(db, id) {
  return unwrap(db.from('time_off').select(COLUMNS).eq('id', id).maybeSingle());
}

export function create(db, row) {
  return unwrap(db.from('time_off').insert(row).select(COLUMNS).single());
}

export function update(db, id, patch) {
  return unwrap(db.from('time_off').update(patch).eq('id', id).select(COLUMNS).maybeSingle());
}

export async function remove(db, id) {
  const rows = await unwrap(db.from('time_off').delete().eq('id', id).select('id'));
  return rows.length > 0;
}
