import { getProfileWithHistory } from '../../services/patients.js';

/** Fetch a logged-in patient's profile + appointment history. */
export async function getPatientHistory({ patient_id }, context = {}) {
  // Only allow access to the authenticated patient's own record.
  if (context.patientId && context.patientId !== patient_id) {
    return { error: 'not_authorized' };
  }
  const data = await getProfileWithHistory(patient_id);
  return data ?? { error: 'not_found' };
}
