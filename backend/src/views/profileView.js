/** The signed-in user, as returned by GET /api/auth/me. */
export function meView(user, { patient = null, staff = null } = {}) {
  return {
    id: user.id,
    role: user.role,
    email: user.email,
    full_name: user.fullName,
    preferred_language: user.preferredLanguage,
    patient_id: user.patientId,
    staff_id: user.staffId,
    patient: patient && {
      id: patient.id,
      full_name: patient.full_name,
      date_of_birth: patient.date_of_birth,
      email: patient.email,
      phone: patient.phone,
      preferred_language: patient.preferred_language,
    },
    staff: staff && { id: staff.id, full_name_en: staff.full_name_en, full_name_ar: staff.full_name_ar, title: staff.title },
  };
}

/** A team member on the owner's team screen. */
export function teamMemberView(profile, { staff = null, disabled = false } = {}) {
  return {
    id: profile.id,
    role: profile.role,
    full_name: profile.full_name,
    email: profile.email,
    phone: profile.phone,
    disabled,
    staff: staff && { id: staff.id, full_name_en: staff.full_name_en, full_name_ar: staff.full_name_ar },
    created_at: profile.created_at,
  };
}
