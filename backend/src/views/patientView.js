/**
 * A patient record. Built by picking allowed fields one by one, so a column added to the
 * table later (or a sign-in secret) can never leak by accident.
 */
export function patientView(row) {
  return {
    id: row.id,
    full_name: row.full_name,
    date_of_birth: row.date_of_birth,
    email: row.email,
    phone: row.phone,
    preferred_language: row.preferred_language,
    has_login: Boolean(row.profile_id),
    created_at: row.created_at,
  };
}

/** Staff also see the clinic's private notes about the patient. */
export function staffPatientView(row) {
  return { ...patientView(row), notes: row.notes };
}
