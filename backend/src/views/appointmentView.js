/** A booking as the patient sees it (from the appointments table with doctor + service). */
export function appointmentView(row) {
  return {
    id: row.id,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    status: row.status,
    source: row.source,
    notes: row.notes,
    cancelled_at: row.cancelled_at,
    cancel_reason: row.cancel_reason,
    created_at: row.created_at,
    doctor: row.doctor
      ? { id: row.doctor.id, full_name_en: row.doctor.full_name_en, full_name_ar: row.doctor.full_name_ar, title: row.doctor.title }
      : { id: row.staff_id },
    service: row.service
      ? {
          id: row.service.id,
          slug: row.service.slug,
          name_en: row.service.name_en,
          name_ar: row.service.name_ar,
          duration_minutes: row.service.duration_minutes,
          price_egp: Number(row.service.price_egp),
        }
      : { id: row.service_id },
  };
}

/** A booking on the staff dashboard (from v_appointments; masked for the viewer). */
export function staffAppointmentView(row) {
  return {
    id: row.id,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    status: row.status,
    source: row.source,
    notes: row.notes,
    cancelled_at: row.cancelled_at,
    created_at: row.created_at,
    doctor: { id: row.staff_id, full_name_en: row.doctor_name_en, full_name_ar: row.doctor_name_ar },
    service: { id: row.service_id, name_en: row.service_name_en, name_ar: row.service_name_ar },
    patient: { id: row.patient_id, full_name: row.patient_name },
  };
}

/** A free time the patient can pick. */
export function slotView(row) {
  return { starts_at: row.slot_start, ends_at: row.slot_end };
}
