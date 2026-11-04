/**
 * Create the accounts for the demo (safe to re-run; accounts that have a password are kept):
 *   - owner   : your private login (linked to Dr. Sarah Mansour)
 *   - staff   : private receptionist login (Mona)
 *   - viewer  : read-only login you share with clients
 *   - patient : demo patient Mariam Hassan (phone sign-in)
 *
 * A team account without a password gets a temporary one. Owner and staff must replace it at
 * first sign-in. This also moves accounts created before sign-in lived in our own backend.
 *
 * Passwords are written to backend/scripts/demo-accounts.local (gitignored). Nothing secret is printed.
 *
 * Usage: npm run seed:accounts -- --owner-email you@example.com
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, temporaryPassword } from '../src/auth/passwords.js';
import { supabase } from '../src/db/supabase.js';
import * as patientModel from '../src/models/patientModel.js';
import * as profileModel from '../src/models/profileModel.js';

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

// Create the account if it doesn't exist; give it a temporary password if it has none.
async function ensureTeamAccount({ email, role, fullName }) {
  const mustChange = role !== 'viewer'; // the demo account can't change its password
  const existing = await profileModel.findTeamLogin(supabase, email);

  if (existing?.password_hash) return { id: existing.id, email, password: null, state: 'kept' };

  const password = temporaryPassword();
  if (existing) {
    await accountService.setPassword(existing.id, password, { mustChange });
    return { id: existing.id, email, password, state: 'password set' };
  }

  const profile = await profileModel.createTeamProfile(supabase, {
    email,
    role,
    full_name: fullName,
    password_hash: await hashPassword(password),
    password_changed_at: new Date().toISOString(),
    must_change_password: mustChange,
  });
  return { id: profile.id, email, password, state: 'created' };
}

const owner = await ensureTeamAccount({ email: ownerEmail, role: 'owner', fullName: 'Dr. Sarah Mansour' });
await supabase.from('staff').update({ profile_id: owner.id }).eq('id', DR_SARAH_STAFF_ID);

const staff = await ensureTeamAccount({ email: 'mona.reception@brightsmile.clinic', role: 'staff', fullName: 'Mona Adel' });
const viewer = await ensureTeamAccount({ email: 'demo@brightsmile.clinic', role: 'viewer', fullName: 'Demo Viewer' });

const mariam = await patientModel.findByPhone(supabase, DEMO_PATIENT_PHONE);

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
    '# Owner and staff passwords here are temporary: they must be changed at first sign-in.',
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

console.log(`owner   ${owner.state} (${owner.email}) → linked to Dr. Sarah Mansour`);
console.log(`staff   ${staff.state}`);
console.log(`viewer  ${viewer.state}`);
console.log(`patient ${mariam ? 'ready: Mariam Hassan' : 'skipped (seed missing)'}`);
console.log(`\nLogins saved to ${path.relative(process.cwd(), outputFile)} (gitignored).`);
