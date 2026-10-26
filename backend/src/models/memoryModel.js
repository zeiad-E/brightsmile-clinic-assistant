import { unwrap } from './query.js';

/** The agent's notes about a patient (preferences, communication style, logistics). */
export function listForPatient(db, patientId, limit = 15) {
  return unwrap(
    db
      .from('patient_memories')
      .select('id, kind, content, source, updated_at')
      .eq('patient_id', patientId)
      .order('updated_at', { ascending: false })
      .limit(limit),
  );
}
