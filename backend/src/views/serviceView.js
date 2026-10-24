/** A treatment as the public sees it. Admin lists add the internal fields. */
export function serviceView(row) {
  return {
    id: row.id,
    slug: row.slug,
    name_en: row.name_en,
    name_ar: row.name_ar,
    description_en: row.description_en,
    description_ar: row.description_ar,
    duration_minutes: row.duration_minutes,
    price_egp: Number(row.price_egp),
  };
}

export function adminServiceView(row) {
  return { ...serviceView(row), is_active: row.is_active, sort_order: row.sort_order, updated_at: row.updated_at };
}
