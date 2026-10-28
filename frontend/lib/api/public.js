import { cacheLife } from 'next/cache';
import { apiRequest } from './client.js';

/**
 * Public clinic data for server components, cached by Next.js so pages don't call the API on every
 * visit. 'use cache' remembers the result; cacheLife says for how long.
 */

/** Name, phone, address, opening hours, booking rules. null if the API is unreachable. */
export async function getClinic() {
  'use cache';
  try {
    const clinic = await apiRequest('/clinic', { timeout: 8000 });
    cacheLife('hours');
    return clinic;
  } catch {
    cacheLife('minutes'); // try again soon instead of remembering the failure for hours
    return null;
  }
}
