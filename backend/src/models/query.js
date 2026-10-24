/**
 * Small helpers shared by every model.
 *
 * Supabase never throws: each call returns `{ data, error }`. `unwrap` turns that into
 * "return the data or throw the error", so a database error always reaches errorHandler
 * (which turns codes like 23505 or 42501 into proper HTTP answers).
 */
export async function unwrap(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

/** Like unwrap, but also returns the total row count (for paginated lists). */
export async function unwrapPage(promise) {
  const { data, error, count } = await promise;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

/** limit/offset → the inclusive row range Supabase expects. */
export function pageRange({ limit = 50, offset = 0 } = {}) {
  return [offset, offset + limit - 1];
}

/**
 * Makes user text safe inside a PostgREST `or(...)` filter, where commas, brackets and
 * wildcards have special meaning. "smith, (x)" would otherwise break or widen the search.
 */
export function searchTerm(text) {
  return String(text).replace(/[,()*%\\:"']/g, ' ').trim();
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
