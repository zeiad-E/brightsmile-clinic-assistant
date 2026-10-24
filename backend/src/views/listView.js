/** Every paginated list answers in the same shape: { data: [...], meta: { limit, offset, total } }. */
export function listView({ rows, total }, { limit, offset }, toItem = (row) => row) {
  return { data: rows.map(toItem), meta: { limit, offset, total } };
}
