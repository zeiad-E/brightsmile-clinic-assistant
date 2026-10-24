/** Times come from Postgres as "10:00:00"; the API uses "10:00". */
export const shortTime = (time) => (time ? String(time).slice(0, 5) : time);

function hoursView(rows = []) {
  return [...rows]
    .sort((a, b) => a.weekday - b.weekday || String(a.start_time).localeCompare(String(b.start_time)))
    .map((h) => ({ weekday: h.weekday, start_time: shortTime(h.start_time), end_time: shortTime(h.end_time) }));
}

/** A doctor/hygienist as the public sees them: who they are, what they do, when they work. */
export function doctorView(row) {
  return {
    id: row.id,
    full_name_en: row.full_name_en,
    full_name_ar: row.full_name_ar,
    title: row.title,
    bio_en: row.bio_en,
    bio_ar: row.bio_ar,
    photo_url: row.photo_url,
    service_ids: (row.staff_services ?? []).map((link) => link.service_id),
    working_hours: hoursView(row.working_hours),
  };
}

export function adminDoctorView(row) {
  return { ...doctorView(row), is_active: row.is_active, profile_id: row.profile_id, updated_at: row.updated_at };
}
