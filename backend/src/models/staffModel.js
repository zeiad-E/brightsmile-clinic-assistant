import { unwrap } from './query.js';

/** Doctors and hygienists, with the services they offer and their weekly hours. */

const COLUMNS = 'id, profile_id, full_name_en, full_name_ar, title, bio_en, bio_ar, photo_url, is_active, created_at, updated_at';
const WITH_DETAILS = `${COLUMNS}, staff_services(service_id), working_hours(weekday, start_time, end_time)`;

export function listActive(db) {
  return unwrap(db.from('staff').select(WITH_DETAILS).eq('is_active', true).order('full_name_en'));
}

export function listAll(db) {
  return unwrap(db.from('staff').select(WITH_DETAILS).order('full_name_en'));
}

export function findById(db, id) {
  return unwrap(db.from('staff').select(WITH_DETAILS).eq('id', id).maybeSingle());
}

/** Active doctors who offer one service (used for "any doctor" availability). */
export async function listActiveForService(db, serviceId) {
  const rows = await unwrap(
    db
      .from('staff_services')
      .select('staff:staff_id(id, full_name_en, full_name_ar, title, is_active)')
      .eq('service_id', serviceId),
  );
  return rows.map((row) => row.staff).filter((staff) => staff?.is_active);
}

export function create(db, row) {
  return unwrap(db.from('staff').insert(row).select(WITH_DETAILS).single());
}

export function update(db, id, patch) {
  return unwrap(db.from('staff').update(patch).eq('id', id).select(WITH_DETAILS).maybeSingle());
}

/** Replaces the whole list in one database transaction (owner only, checked by the DB). */
export function setServices(db, staffId, serviceIds) {
  return unwrap(db.rpc('set_staff_services', { p_staff_id: staffId, p_service_ids: serviceIds }));
}

/** Links a doctor record to a team login (or unlinks with null). */
export function linkProfile(db, staffId, profileId) {
  return unwrap(db.from('staff').update({ profile_id: profileId }).eq('id', staffId).select('id, profile_id').maybeSingle());
}

/** The doctor record linked to a login, if any. */
export function findByProfileId(db, profileId) {
  return unwrap(db.from('staff').select(COLUMNS).eq('profile_id', profileId).maybeSingle());
}

export function unlinkProfile(db, profileId) {
  return unwrap(db.from('staff').update({ profile_id: null }).eq('profile_id', profileId));
}

export function listLinkedProfiles(db) {
  return unwrap(db.from('staff').select('id, profile_id, full_name_en, full_name_ar').not('profile_id', 'is', null));
}
