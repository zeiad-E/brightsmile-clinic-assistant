/**
 * A team member is locked out (for example the owner lost their password): gives them a new
 * temporary password, ends their sessions and clears any lockout. They must replace it at the
 * next sign-in. The password is written to backend/scripts/password-reset.local (gitignored),
 * never printed.
 *
 * Usage: npm run auth:reset-password -- --email you@example.com
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { temporaryPassword } from '../src/auth/passwords.js';
import * as sessions from '../src/auth/sessions.js';
import { supabase } from '../src/db/supabase.js';
import * as profileModel from '../src/models/profileModel.js';
import * as accountService from '../src/services/accountService.js';

const emailArg = process.argv.indexOf('--email');
const email = emailArg > -1 ? process.argv[emailArg + 1] : null;
if (!supabase || !email) {
  console.error('Usage: npm run auth:reset-password -- --email you@example.com (needs backend/.env)');
  process.exit(1);
}

const member = await profileModel.findTeamLogin(supabase, email);
if (!member) {
  console.error('No team account has this email.');
  process.exit(1);
}

const password = temporaryPassword();
await accountService.setPassword(member.id, password, { mustChange: member.role !== 'viewer' });
await sessions.revokeAllFor(member.id, 'password_reset');

const outputFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'password-reset.local');
fs.writeFileSync(outputFile, `${email} / ${password}\n`);
console.log(`New temporary password saved to ${path.relative(process.cwd(), outputFile)} (gitignored). Delete that file once used.`);
