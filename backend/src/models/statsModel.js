import { unwrap } from './query.js';

/** Dashboard numbers from the reporting views ("today" = the clinic's day). */

export function today(db) {
  return unwrap(db.from('v_stats_today').select('*').maybeSingle());
}

export function aiOutcomes(db) {
  return unwrap(db.from('v_ai_outcomes_7d').select('*'));
}

export function upcomingByDoctor(db) {
  return unwrap(db.from('v_stats_upcoming_by_doctor').select('*').order('full_name_en'));
}
