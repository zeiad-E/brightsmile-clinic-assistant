import { pageRange, unwrapPage } from './query.js';

/** Who changed what, before and after (owner/viewer; private notes hidden from the viewer). */
export function list(db, { entity, entityId, from, to, limit, offset }) {
  let query = db
    .from('v_audit_log')
    .select('id, actor_id, via, action, entity, entity_id, before, after, created_at', { count: 'exact' })
    .order('id', { ascending: false });
  if (entity) query = query.eq('entity', entity);
  if (entityId) query = query.eq('entity_id', entityId);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lt('created_at', to);
  return unwrapPage(query.range(...pageRange({ limit, offset })));
}
