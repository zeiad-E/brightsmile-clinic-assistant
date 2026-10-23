/**
 * Create the login accounts for the demo (safe to re-run; existing accounts are kept):
 *   - owner   : your private login (linked to Dr. Sarah Mansour)
 *   - staff   : private receptionist login (Mona)
 *   - viewer  : read-only login you share with clients
 *   - patient : demo patient Mariam Hassan (phone sign-in), linked to her patient record
 *
 * Passwords are generated and written to backend/scripts/demo-accounts.local (gitignored).
 * Nothing secret is printed.
 *
 * Usage: npm run seed:accounts -- --owner-email you@example.com
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabase } from '../src/db/supabase.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputFile = path.join(here, 'demo-accounts.local');

if (!supabase) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env first.');
  process.exit(1);
}

const ownerEmailArg = process.argv.indexOf('--owner-email');
const ownerEmail = ownerEmailArg > -1 ? process.argv[ownerEmailArg + 1] : process.env.SEED_OWNER_EMAIL;
if (!ownerEmail) {
  console.error('Pass your own email for the owner login: npm run seed:accounts -- --owner-email you@example.com');
  process.exit(1);
}

const DR_SARAH_STAFF_ID = '5eed0000-0000-4000-a000-000000000101';
const DEMO_PATIENT_PHONE = '+201000000001';

const password = () => crypto.randomBytes(12).toString('base64url');

async function findUserByEmail(email) {
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 200) return null;
  }
  return null;
}

// Create the login if it doesn't exist; keep the password of an existing one.
async function ensureUser({ email, role, fullName, language = 'en' }) {
  const existing = await findUserByEmail(email);
  if (existing) {
    const { error } = await supabase.from('profiles').update({ role, full_name: fullName }).eq('id', existing.id);
    if (error) throw error;
    return { id: existing.id, email, password: null, created: false };
  }

  const pwd = password();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: pwd,
    email_confirm: true,
    app_metadata: { role },
    user_metadata: { full_name: fullName, preferred_language: language },
  });
  if (error) throw error;
  return { id: data.user.id, email, password: pwd, created: true };
}

const owner = await ensureUser({ email: ownerEmail, role: 'owner', fullName: 'Dr. Sarah Mansour' });
await supabase.from('staff').update({ profile_id: owner.id }).eq('id', DR_SARAH_STAFF_ID);

const staff = await ensureUser({ email: 'mona.reception@brightsmile.clinic', role: 'staff', fullName: 'Mona Adel' });
const viewer = await ensureUser({ email: 'demo@brightsmile.clinic', role: 'viewer', fullName: 'Demo Viewer' });

// Demo patient: phone-only, so the login uses an internal placeholder email.
const { data: mariam, error: mariamError } = await supabase
  .from('patients')
  .select('id, full_name, date_of_birth, profile_id')
  .eq('phone', DEMO_PATIENT_PHONE)
  .maybeSingle();
if (mariamError) throw mariamError;

let patient = null;
if (mariam) {
  patient = await ensureUser({
    email: `patient-${mariam.id}@patients.brightsmile.app`,
    role: 'patient',
    fullName: mariam.full_name,
    language: 'ar',
  });
  const { error } = await supabase.from('patients').update({ profile_id: patient.id }).eq('id', mariam.id);
  if (error) throw error;
}

// Keep passwords from earlier runs; add new ones.
const previous = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : '';
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const remembered = (email) => previous.match(new RegExp(`\\s${escapeRegExp(email)} / (\\S+)`))?.[1];
const line = (label, account) =>
  `${label.padEnd(8)} ${account.email} / ${account.password ?? remembered(account.email) ?? '(kept existing password)'}`;

fs.writeFileSync(
  outputFile,
  [
    '# Demo logins (gitignored). Owner + staff are private; share only the viewer login.',
    line('owner', owner),
    line('staff', staff),
    line('viewer', viewer),
    '',
    '# Demo patient: sign in with phone + full name + date of birth',
    mariam
      ? `patient  phone ${DEMO_PATIENT_PHONE} · name ${mariam.full_name} · date of birth ${mariam.date_of_birth}`
      : 'patient  (not found: run the database seed first)',
    '',
  ].join('\n'),
);

console.log(`owner   ${owner.created ? 'created' : 'already existed'} (${owner.email}) → linked to Dr. Sarah Mansour`);
console.log(`staff   ${staff.created ? 'created' : 'already existed'}`);
console.log(`viewer  ${viewer.created ? 'created' : 'already existed'}`);
console.log(`patient ${patient ? (patient.created ? 'created' : 'already existed') + ' → linked to Mariam Hassan' : 'skipped (seed missing)'}`);
console.log(`\nLogins saved to ${path.relative(process.cwd(), outputFile)} (gitignored).`);
