import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { fakeIdentity, fakeUserClientModule, ROLE_IDS, tokenFor } from './helpers/fakeAuth.js';

/**
 * The permission matrix: every endpoint × every role → let in, or turned away?
 *
 * Services are replaced with stubs, so this test checks ONLY the doors (authenticate +
 * requireRole + validation order), not the business logic. "Let in" = anything except
 * 401/403. The database's own security rules are tested separately (SQL tests).
 */
vi.mock('../../src/db/userClient.js', () => fakeUserClientModule());
vi.mock('../../src/models/profileModel.js', async () => {
  const { fakeIdentity: identity, ROLE_IDS: ids } = await import('./helpers/fakeAuth.js');
  return {
    findIdentity: async (_db, userId) => {
      const role = Object.keys(ids).find((r) => ids[r] === userId);
      return role ? identity(role) : null;
    },
  };
});

const stubModule = (names, value = {}) => Object.fromEntries(names.map((n) => [n, vi.fn(async () => value)]));
const LIST = { data: [], meta: {} };

vi.mock('../../src/services/authService.js', () =>
  stubModule(['staffLogin', 'startEmailCode', 'verifyEmailCode', 'phoneLogin', 'codeLogin', 'resendCode', 'refresh', 'logout', 'me', 'changePassword', 'teamProfile', 'updateTeamProfile']),
);
vi.mock('../../src/services/catalogService.js', () => stubModule(['clinicInfo', 'listServices', 'getService', 'listDoctors', 'getDoctor']));
vi.mock('../../src/services/availabilityService.js', () => stubModule(['forDay', 'forRange']));
vi.mock('../../src/services/bookingService.js', () => ({
  bookAsVisitor: vi.fn(async () => ({ status: 201, body: {} })),
  bookAsStaff: vi.fn(async () => ({ status: 201, body: {} })),
}));
vi.mock('../../src/services/appointmentService.js', () =>
  stubModule(['listMine', 'getMine', 'cancel', 'reschedule', 'listForStaff', 'getForStaff', 'setStatus'], LIST),
);
vi.mock('../../src/services/patientService.js', () =>
  stubModule(['myProfile', 'updateMyLanguage', 'search', 'getWithAppointments', 'update', 'unlock', 'sendNewCode', 'create', 'startContactChange', 'verifyContactChange'], LIST),
);
vi.mock('../../src/services/escalationService.js', () => stubModule(['list', 'resolve'], LIST));
vi.mock('../../src/services/scheduleService.js', () =>
  stubModule(['listTimeOff', 'createTimeOff', 'updateTimeOff', 'removeTimeOff', 'replaceWorkingHours', 'replaceStaffServices'], LIST),
);
vi.mock('../../src/services/reportService.js', () =>
  stubModule(['statsToday', 'upcomingByDoctor', 'aiOutcomes', 'auditLog', 'notifications', 'rangeStats', 'assistantActivity'], LIST),
);
vi.mock('../../src/services/assistantReportService.js', () => stubModule(['create', 'list', 'resolve'], LIST));
vi.mock('../../src/services/adminService.js', () =>
  stubModule(['listServices', 'createService', 'updateService', 'deactivateService', 'listDoctors', 'createDoctor', 'updateDoctor', 'deactivateDoctor', 'getSettings', 'updateSettings']),
);
vi.mock('../../src/services/teamService.js', () => stubModule(['list', 'create', 'setRole', 'setDisabled', 'updateMember', 'resendInvite']));
vi.mock('../../src/services/memoryService.js', () =>
  stubModule(['listForOwner', 'createByOwner', 'updateByOwner', 'removeByOwner', 'forgetPatient', 'scheduleSummaries'], LIST),
);
vi.mock('../../src/services/knowledge/knowledgeService.js', () =>
  stubModule(['list', 'get', 'create', 'update', 'remove', 'reingest', 'upload', 'listGaps', 'setGapStatus', 'ingestJob'], LIST),
);
vi.mock('../../src/services/intakeService.js', () => stubModule(['listFields', 'createField', 'updateField', 'removeField', 'missingFor', 'saveAnswers'], LIST));
vi.mock('../../src/services/chatService.js', () =>
  stubModule(['sendMessage', 'getConversation', 'listMine', 'listForStaff', 'getForStaff', 'takeOver', 'handBack', 'staffReply', 'review'], LIST),
);

const { createApp } = await import('../../src/app.js');
const app = createApp({ rateLimit: false });

const ID = '00000000-0000-4000-a000-000000000999';
const SERVICE = '00000000-0000-4000-a000-000000000201';
const DOCTOR = '00000000-0000-4000-a000-000000000101';
const KEY = '11111111-2222-4333-8444-555555555555';
const SOON = '2026-12-01T10:00:00+02:00';

const booking = { service_id: SERVICE, staff_id: DOCTOR, starts_at: SOON };
const staffBooking = { ...booking, full_name: 'Walk In', date_of_birth: '1990-01-01', phone: '+201001234567' };
const service = { slug: 'new-thing', name_en: 'New', name_ar: 'جديد', duration_minutes: 30, price_egp: 100 };
const doctor = { full_name_en: 'Dr. New', full_name_ar: 'د. جديد', title: 'dentist' };

const ALL = ['anon', 'patient', 'viewer', 'staff', 'owner'];
const SIGNED_IN = ['patient', 'viewer', 'staff', 'owner'];
const STAFF_READ = ['viewer', 'staff', 'owner'];
const STAFF_WRITE = ['staff', 'owner'];
const ADMIN_READ = ['viewer', 'owner'];
const OWNER = ['owner'];
const TEAM = ['viewer', 'staff', 'owner'];

// [method, path, body, roles allowed in, extra headers]
const MATRIX = [
  ['get', '/api/clinic', null, ALL],
  ['get', '/api/services', null, ALL],
  ['get', '/api/services/teeth-cleaning', null, ALL],
  ['get', '/api/doctors', null, ALL],
  ['get', `/api/doctors/${DOCTOR}`, null, ALL],
  ['get', `/api/availability?service_id=${SERVICE}&staff_id=${DOCTOR}&date=2026-12-01`, null, ALL],
  ['get', `/api/availability/range?service_id=${SERVICE}`, null, ALL],

  ['post', '/api/auth/staff/login', { email: 'a@b.co', password: 'x' }, ALL],
  ['post', '/api/auth/email/start', { email: 'a@b.co' }, ALL],
  ['post', '/api/auth/phone', { phone: '+201001234567', full_name: 'Ahmed Ali', date_of_birth: '1990-01-01' }, ALL],
  ['post', '/api/auth/code', { code: 'K7Q4-9M2X' }, ALL],
  ['post', '/api/auth/logout', null, SIGNED_IN],
  ['get', '/api/auth/me', null, SIGNED_IN],
  // The read-only demo login can't change its password.
  ['post', '/api/auth/password', { current_password: 'old', new_password: 'a-new-password' }, STAFF_WRITE],
  ['get', '/api/auth/profile', null, TEAM],
  ['patch', '/api/auth/profile', { full_name: 'Sara Adel' }, STAFF_WRITE],

  // Staff are refused inside the booking service (tested there), not at the door.
  ['post', '/api/appointments', booking, ALL, { 'idempotency-key': KEY }],

  ['get', '/api/me', null, ['patient']],
  ['patch', '/api/me', { preferred_language: 'ar' }, ['patient']],
  ['get', '/api/me/appointments', null, ['patient']],
  ['get', `/api/me/appointments/${ID}`, null, ['patient']],
  ['post', `/api/me/appointments/${ID}/cancel`, {}, ['patient']],
  ['post', `/api/me/appointments/${ID}/reschedule`, { starts_at: SOON }, ['patient']],
  ['post', '/api/me/contact', { field: 'email', value: 'new@b.co' }, ['patient']],
  ['post', '/api/me/contact/verify', { field: 'email', code: '123456' }, ['patient']],

  ['get', '/api/staff/appointments', null, STAFF_READ],
  ['get', `/api/staff/appointments/${ID}`, null, STAFF_READ],
  ['post', '/api/staff/appointments', staffBooking, STAFF_WRITE, { 'idempotency-key': KEY }],
  ['post', `/api/staff/appointments/${ID}/cancel`, {}, STAFF_WRITE],
  ['post', `/api/staff/appointments/${ID}/reschedule`, { starts_at: SOON }, STAFF_WRITE],
  ['patch', `/api/staff/appointments/${ID}/status`, { status: 'completed' }, STAFF_WRITE],
  ['get', '/api/staff/patients?q=ahmed', null, STAFF_READ],
  ['post', '/api/staff/patients', { full_name: 'New Patient', date_of_birth: '1990-01-01', phone: '+201001234567' }, STAFF_WRITE],
  ['get', `/api/staff/patients/${ID}`, null, STAFF_READ],
  ['patch', `/api/staff/patients/${ID}`, { notes: 'Prefers mornings' }, STAFF_WRITE],
  ['post', `/api/staff/patients/${ID}/unlock`, null, STAFF_WRITE],
  ['post', `/api/staff/patients/${ID}/send-code`, null, STAFF_WRITE],
  ['get', '/api/staff/escalations', null, STAFF_READ],
  ['post', `/api/staff/escalations/${ID}/resolve`, null, STAFF_WRITE],
  ['get', '/api/staff/time-off', null, STAFF_READ],
  ['post', '/api/staff/time-off', { staff_id: null, starts_at: SOON, ends_at: '2026-12-01T18:00:00+02:00' }, STAFF_WRITE],
  ['patch', `/api/staff/time-off/${ID}`, { reason: 'Conference' }, STAFF_WRITE],
  ['delete', `/api/staff/time-off/${ID}`, null, STAFF_WRITE],
  ['get', '/api/staff/stats/today', null, STAFF_READ],
  ['get', '/api/staff/stats/upcoming-by-doctor', null, STAFF_READ],

  ['get', '/api/admin/services', null, ADMIN_READ],
  ['post', '/api/admin/services', service, OWNER],
  ['patch', `/api/admin/services/${ID}`, { price_egp: 600 }, OWNER],
  ['delete', `/api/admin/services/${ID}`, null, OWNER],
  ['get', '/api/admin/doctors', null, ADMIN_READ],
  ['post', '/api/admin/doctors', doctor, OWNER],
  ['patch', `/api/admin/doctors/${ID}`, { bio_en: 'Hi' }, OWNER],
  ['delete', `/api/admin/doctors/${ID}`, null, OWNER],
  ['put', `/api/admin/doctors/${ID}/services`, { service_ids: [SERVICE] }, OWNER],
  ['put', `/api/admin/doctors/${ID}/working-hours`, { hours: [{ weekday: 0, start_time: '10:00', end_time: '18:00' }] }, OWNER],
  ['get', '/api/admin/settings', null, ADMIN_READ],
  ['patch', '/api/admin/settings', { min_lead_minutes: 60 }, OWNER],
  ['get', '/api/admin/team', null, ADMIN_READ],
  ['post', '/api/admin/team', { email: 'new@b.co', full_name: 'New Person', role: 'staff' }, OWNER],
  ['patch', `/api/admin/team/${ID}`, { full_name: 'New Name' }, OWNER],
  ['patch', `/api/admin/team/${ID}/role`, { role: 'viewer' }, OWNER],
  ['post', `/api/admin/team/${ID}/resend-invite`, null, OWNER],
  ['post', `/api/admin/team/${ID}/disable`, null, OWNER],
  ['post', `/api/admin/team/${ID}/enable`, null, OWNER],
  ['get', '/api/admin/audit-log', null, ADMIN_READ],
  ['get', '/api/admin/notifications', null, ADMIN_READ],

  // Chat: open to everyone; who may continue a conversation is checked inside the service.
  ['post', '/api/chat', { message: 'Hello' }, ALL],
  ['get', `/api/chat/${ID}`, null, ALL],
  ['get', '/api/me/conversations', null, ['patient']],
  ['get', '/api/staff/conversations', null, STAFF_READ],
  ['get', `/api/staff/conversations/${ID}`, null, STAFF_READ],
  ['post', `/api/staff/conversations/${ID}/take-over`, null, STAFF_WRITE],
  ['post', `/api/staff/conversations/${ID}/hand-back`, null, STAFF_WRITE],
  ['post', `/api/staff/conversations/${ID}/messages`, { message: 'Hello, this is Sara from the clinic.' }, STAFF_WRITE],
  ['post', `/api/staff/conversations/${ID}/review`, { note: 'Good' }, STAFF_WRITE],
  ['post', `/api/staff/conversations/${ID}/reports`, { kind: 'wrong_answer', note: 'Wrong price' }, STAFF_WRITE],
  ['get', '/api/staff/stats/ai-outcomes', null, STAFF_READ],

  // Memory: the agent's notes are owner-only (not even the viewer); "forget me" is the patient's.
  ['get', '/api/admin/agent/memories', null, OWNER],
  ['post', '/api/admin/agent/memories', { patient_id: ID, kind: 'preference', content: 'Prefers mornings' }, OWNER],
  ['patch', `/api/admin/agent/memories/${ID}`, { content: 'Prefers evenings' }, OWNER],
  ['delete', `/api/admin/agent/memories/${ID}`, null, OWNER],
  ['get', '/api/admin/intake-fields', null, ADMIN_READ],
  ['post', '/api/admin/intake-fields', { key: 'job', label_en: 'Job', label_ar: 'الوظيفة', kind: 'text' }, OWNER],
  ['patch', `/api/admin/intake-fields/${ID}`, { required: true }, OWNER],
  ['delete', `/api/admin/intake-fields/${ID}`, null, OWNER],
  ['delete', '/api/me/memory', null, ['patient']],
  ['get', '/api/admin/agent/status', null, ADMIN_READ],
  ['get', '/api/admin/agent/activity', null, ADMIN_READ],
  ['get', '/api/admin/agent/reports', null, ADMIN_READ],
  ['post', `/api/admin/agent/reports/${ID}/resolve`, {}, OWNER],
  ['get', '/api/admin/stats?from=2026-10-01&to=2026-10-31', null, ADMIN_READ],

  // Knowledge base and unanswered questions.
  ['get', '/api/admin/knowledge', null, ADMIN_READ],
  ['post', '/api/admin/knowledge', { group_key: 'parking', language: 'en', category: 'location', title: 'Parking', content: 'Free parking behind the clinic.' }, OWNER],
  ['post', '/api/admin/knowledge/upload', { multipart: true }, OWNER],
  ['get', `/api/admin/knowledge/${ID}`, null, ADMIN_READ],
  ['patch', `/api/admin/knowledge/${ID}`, { is_published: false }, OWNER],
  ['delete', `/api/admin/knowledge/${ID}`, null, OWNER],
  ['post', `/api/admin/knowledge/${ID}/reingest`, null, OWNER],
  ['get', '/api/admin/knowledge-gaps', null, ADMIN_READ],
  ['patch', `/api/admin/knowledge-gaps/${ID}`, { status: 'resolved' }, OWNER],
];

function send(method, path, body, role, headers = {}) {
  let req = request(app)[method](path).set(headers);
  if (role !== 'anon') req = req.set('authorization', `Bearer ${tokenFor(role)}`);
  if (body?.multipart) {
    return req
      .field('group_key', 'parking')
      .field('language', 'en')
      .field('category', 'location')
      .attach('file', Buffer.from('Free parking behind the clinic.'), 'parking.txt');
  }
  return body ? req.send(body) : req;
}

describe('permission matrix', () => {
  const cases = MATRIX.flatMap(([method, path, body, allowed, headers]) =>
    ALL.map((role) => [`${method.toUpperCase()} ${path.split('?')[0]}`, role, allowed.includes(role), method, path, body, headers]),
  );

  it.each(cases)('%s as %s → allowed: %s', async (_name, role, allowed, method, path, body, headers) => {
    const res = await send(method, path, body, role, headers);

    if (allowed) {
      expect([401, 403], `${role} should get in (got ${res.status}: ${JSON.stringify(res.body)})`).not.toContain(res.status);
      expect(res.status).toBeLessThan(400);
    } else {
      expect(res.status, `${role} must be turned away`).toBe(role === 'anon' ? 401 : 403);
    }
  });
});

describe('authenticate', () => {
  it('rejects a broken token instead of treating the caller as a visitor', async () => {
    const res = await request(app).get('/api/services').set('authorization', 'Bearer stranger.fake.token');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('rejects an Authorization header that is not a Bearer token', async () => {
    const res = await request(app).get('/api/services').set('authorization', 'Basic dXNlcjpwYXNz');

    expect(res.status).toBe(401);
  });

  it('knows who the caller is', () => {
    expect(fakeIdentity('owner').id).toBe(ROLE_IDS.owner);
  });
});

describe('input checks run after the door', () => {
  it('requires an Idempotency-Key on bookings', async () => {
    const res = await request(app).post('/api/appointments').send(booking);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('idempotency_key_required');
  });

  it('refuses invalid ids with a clear field error', async () => {
    const res = await send('get', '/api/staff/appointments/not-a-uuid', null, 'staff');

    expect(res.status).toBe(400);
    expect(res.body.details[0].path).toBe('id');
  });

  it('refuses a time off that ends before it starts', async () => {
    const res = await send('post', '/api/staff/time-off', { staff_id: null, starts_at: SOON, ends_at: '2026-12-01T09:00:00+02:00' }, 'staff');

    expect(res.status).toBe(400);
    expect(res.body.details[0].path).toBe('ends_at');
  });

  it('never lets anyone be made owner through the team screen', async () => {
    const res = await send('post', '/api/admin/team', { email: 'x@b.co', full_name: 'Sneaky One', role: 'owner' }, 'owner');

    expect(res.status).toBe(400);
  });
});
