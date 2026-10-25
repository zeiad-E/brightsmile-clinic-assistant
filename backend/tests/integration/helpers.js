import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { supabaseAdmin } from '../../src/db/supabase.js';
import { setEmailAdapter } from '../../src/services/email/emailService.js';

/**
 * Shared tools for the integration tests.
 *
 * Every record a test creates is marked so cleanup can find it — and ONLY it:
 *  - emails end with @integration.test (a reserved domain that can never receive mail)
 *  - names start with "IT <run id>"
 *  - phone numbers are remembered exactly (a prefix could match a real patient)
 */
export const RUN = Date.now().toString(36);
export const TEST_DOMAIN = 'integration.test';
export const NAME_PREFIX = `IT ${RUN}`;
export const nameFor = (name) => `${NAME_PREFIX} ${name}`;
export const emailFor = (name) => `it-${RUN}-${name}@${TEST_DOMAIN}`;
const usedPhones = [];
export const phoneFor = () => {
  const phone = `+20109${crypto.randomInt(1_000_000, 9_999_999)}`;
  usedPhones.push(phone);
  return phone;
};
export const newKey = () => crypto.randomUUID();

if (!supabaseAdmin) throw new Error('Integration tests need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
export const admin = supabaseAdmin;

export const app = createApp({ rateLimit: false });

/** Captures emails instead of sending them, so tests can read personal codes. */
export const mails = [];
setEmailAdapter({ name: 'capture', send: async (message) => mails.push(message) });

export async function waitForMail(to, template = '') {
  for (let i = 0; i < 50; i += 1) {
    const found = mails.findLast((m) => m.to === to && m.subject.toLowerCase().includes(template));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No email to ${to}`);
}

export const codeIn = (mail) => /([A-Z2-9]{4}-[A-Z2-9]{4})/.exec(mail.text)?.[1];

/** One HTTP call into the app. */
export function api(method, path, { token, body, key } = {}) {
  let req = request(app)[method](`/api${path}`);
  if (token) req = req.set('authorization', `Bearer ${token}`);
  if (key) req = req.set('idempotency-key', key);
  return body === undefined ? req : req.send(body);
}

/** Creates a team login (owner/staff/viewer) directly through the Auth admin API. */
export const createdUserIds = [];
export async function createTeamUser(role) {
  const email = emailFor(role);
  const password = `It-${crypto.randomBytes(9).toString('base64url')}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role },
    user_metadata: { full_name: `IT ${role}` },
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  // Same as accountService: the profile trigger can't see app_metadata, so set the role here.
  const { error: profileError } = await admin.from('profiles').update({ role }).eq('id', data.user.id);
  if (profileError) throw profileError;
  return { id: data.user.id, email, password };
}

export async function login({ email, password }) {
  const res = await api('post', '/auth/staff/login', { body: { email, password } });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/**
 * Free start times at least `minHoursAhead` from now (default 30 h, safely outside the
 * 24 h cancellation window), for one doctor and service, searching day by day.
 * Picked at least an hour apart, so one patient's bookings never overlap each other.
 */
export async function freeSlots({ serviceId, staffId, minHoursAhead = 30, count = 10 }) {
  const HOUR = 3_600_000;
  let next = Date.now() + minHoursAhead * HOUR;
  const found = [];
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' });
  for (let d = 1; d <= 28 && found.length < count; d += 1) {
    const day = fmt.format(new Date(Date.now() + d * 86_400_000));
    const res = await api('get', `/availability?service_id=${serviceId}&staff_id=${staffId}&date=${day}`);
    for (const slot of res.body.slots ?? []) {
      const start = new Date(slot.starts_at).getTime();
      if (start >= next && found.length < count) {
        found.push(slot.starts_at);
        next = start + HOUR;
      }
    }
  }
  if (found.length < count) throw new Error(`Only ${found.length} free slots found`);
  return found;
}

/** Records created outside the API (or that cleanup can't find by marker). */
export const tracked = { timeOff: [], escalations: [], staff: [], services: [] };
export let originalSettings = null;
export const rememberSettings = (settings) => {
  originalSettings = settings;
};

/**
 * Removes every test record from the database, in an order that respects foreign keys:
 * appointments → notifications → patients → logins, then catalog test rows.
 */
export async function cleanup() {
  const report = {};
  const like = `%@${TEST_DOMAIN}`;

  const filters = [`email.like.${like}`, `full_name.like.${NAME_PREFIX}%`];
  if (usedPhones.length) filters.push(`phone.in.(${usedPhones.map((p) => `"${p}"`).join(',')})`);
  const { data: patients } = await admin.from('patients').select('id, profile_id').or(filters.join(','));
  const patientIds = (patients ?? []).map((p) => p.id);
  const patientLogins = (patients ?? []).map((p) => p.profile_id).filter(Boolean);

  if (patientIds.length) {
    const { data: appts } = await admin.from('appointments').select('id').in('patient_id', patientIds);
    const apptIds = (appts ?? []).map((a) => a.id);
    if (apptIds.length) {
      await admin.from('notifications').delete().in('appointment_id', apptIds);
      await admin.from('audit_log').delete().eq('entity', 'appointments').in('entity_id', apptIds);
      await admin.from('appointments').delete().in('id', apptIds);
    }
    await admin.from('notifications').delete().in('patient_id', patientIds);
    await admin.from('escalations').delete().in('patient_id', patientIds);
    await admin.from('patients').delete().in('id', patientIds);
    report.patients = patientIds.length;
    report.appointments = apptIds.length;
  }
  await admin.from('notifications').delete().like('to_address', like);

  if (tracked.escalations.length) await admin.from('escalations').delete().in('id', tracked.escalations);
  if (tracked.timeOff.length) {
    await admin.from('audit_log').delete().eq('entity', 'time_off').in('entity_id', tracked.timeOff);
    await admin.from('time_off').delete().in('id', tracked.timeOff);
  }
  if (tracked.staff.length) {
    await admin.from('audit_log').delete().in('entity', ['staff', 'working_hours', 'staff_services']).in('entity_id', tracked.staff);
    await admin.from('staff').delete().in('id', tracked.staff);
  }
  const { data: services } = await admin.from('services').select('id').like('slug', `it-${RUN}%`);
  const serviceIds = (services ?? []).map((s) => s.id);
  if (serviceIds.length) {
    await admin.from('audit_log').delete().eq('entity', 'services').in('entity_id', serviceIds);
    await admin.from('services').delete().in('id', serviceIds);
  }

  if (originalSettings) {
    const { min_lead_minutes: minLead, cancellation_window_hours: window } = originalSettings;
    await admin.from('clinic_settings').update({ min_lead_minutes: minLead, cancellation_window_hours: window }).eq('id', 1);
  }

  // Logins: team users made here, patient logins of test patients, and any test-domain login.
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const loginIds = new Set([...createdUserIds, ...patientLogins]);
  for (const user of users?.users ?? []) if (user.email?.endsWith(`@${TEST_DOMAIN}`)) loginIds.add(user.id);
  if (loginIds.size) await admin.from('audit_log').delete().in('actor_id', [...loginIds]);
  for (const id of loginIds) await admin.auth.admin.deleteUser(id);
  report.logins = loginIds.size;

  return report;
}
