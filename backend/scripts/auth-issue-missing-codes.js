/**
 * Gives a personal code to every patient who has none, so everyone can see one in their profile
 * and on a printed card. Patients who already have a code keep it. Safe to re-run; no emails are
 * sent and no code is printed.
 *
 * Usage: npm run auth:issue-missing-codes
 */
import { supabase } from '../src/db/supabase.js';
import { issueCode } from '../src/services/personalCodeService.js';

if (!supabase) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env first.');
  process.exit(1);
}

const { data: patients, error } = await supabase.from('patients').select('id').is('code_hmac', null);
if (error) throw error;

for (const patient of patients) await issueCode(patient.id);
console.log(`Issued ${patients.length} personal code(s).`);
