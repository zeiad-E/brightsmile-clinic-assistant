import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
  api,
  cleanup,
  codeIn,
  createTeamUser,
  emailFor,
  freeSlots,
  login,
  nameFor,
  newKey,
  phoneFor,
  rememberSettings,
  RUN,
  tracked,
  waitForMail,
} from './helpers.js';

/**
 * End-to-end through the real stack: HTTP → middlewares → services → Supabase
 * (Auth, RPC functions, Row Level Security, masked views, audit triggers).
 *
 * The steps build on each other, like a real day at the clinic. Everything created is
 * removed in afterAll.
 */

const SERVICE = '5eed0000-0000-4000-a000-000000000201'; // check-up, 20 min (seed)
const DOCTOR = '5eed0000-0000-4000-a000-000000000101'; // Dr. Sarah (seed)

const team = {};
const state = {};
let slots = [];

beforeAll(async () => {
  for (const role of ['owner', 'staff', 'viewer']) {
    const user = await createTeamUser(role);
    team[role] = { ...user, token: (await login(user)).access_token };
  }
  const { data: settings } = await admin.from('clinic_settings').select('*').eq('id', 1).single();
  rememberSettings(settings);
  slots = await freeSlots({ serviceId: SERVICE, staffId: DOCTOR, count: 8 });
});

afterAll(async () => {
  const report = await cleanup();
  console.log(`cleanup (run ${RUN}):`, report);
});

const book = (body, { token, key = newKey() } = {}) =>
  api('post', '/appointments', { token, key, body: { service_id: SERVICE, staff_id: DOCTOR, ...body } });

describe('team sign-in', () => {
  it('signs in with a password and knows the role', async () => {
    const me = await api('get', '/auth/me', { token: team.staff.token });

    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ role: 'staff', email: team.staff.email });
  });

  it('refuses a wrong password with one generic answer', async () => {
    const res = await api('post', '/auth/staff/login', { body: { email: team.staff.email, password: 'wrong-password' } });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_credentials');
  });
});

describe('guest booking', () => {
  const guest = { full_name: nameFor('Mona'), date_of_birth: '1991-03-04', email: emailFor('mona'), preferred_language: 'en' };

  it('books a new guest, signs them in, and emails a personal code', async () => {
    state.monaKey = newKey();
    const res = await book({ ...guest, starts_at: slots[0] }, { key: state.monaKey });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.is_new_patient).toBe(true);
    expect(res.body.session.access_token).toBeTruthy();
    expect(res.body.appointment).toMatchObject({ status: 'booked', source: 'website', service: { id: SERVICE } });

    state.mona = res.body.session;
    state.monaAppt = res.body.appointment.id;
    state.monaCode = codeIn(await waitForMail(guest.email, 'confirmed'));
    expect(state.monaCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it('the new session works: the patient sees their own profile', async () => {
    const res = await api('get', '/me', { token: state.mona.access_token });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: guest.email, has_login: true });
    expect(res.body).not.toHaveProperty('code_hmac');
  });

  it('a replayed request returns the same booking and creates nothing new', async () => {
    const res = await book({ ...guest, starts_at: slots[0] }, { key: state.monaKey });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ replayed: true, appointment: { id: state.monaAppt } });
    const { count } = await admin.from('appointments').select('id', { count: 'exact', head: true }).eq('idempotency_key', state.monaKey);
    expect(count).toBe(1);
  });

  it('a matching existing patient gets the booking but NOT a session', async () => {
    const res = await book({ ...guest, starts_at: slots[1] });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.is_new_patient).toBe(false);
    expect(res.body.session).toBeNull();
    state.monaSecondAppt = res.body.appointment.id;
  });

  it('a wrong date of birth for a known email is refused', async () => {
    const res = await book({ ...guest, date_of_birth: '1980-01-01', starts_at: slots[2] });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('identity_mismatch');
  });
});

describe('race: many people click the same time at once', () => {
  it('exactly one wins; everyone else gets slot_taken with fresh alternatives', async () => {
    const attempts = Array.from({ length: 8 }, (_, i) =>
      book({ full_name: nameFor(`Racer ${i}`), date_of_birth: '1990-01-01', email: emailFor(`racer${i}`), starts_at: slots[3] }),
    );
    const results = await Promise.all(attempts);
    const statuses = results.map((r) => r.status);

    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    const loser = results.find((r) => r.status === 409);
    expect(loser.body.error).toBe('slot_taken');
    expect(Array.isArray(loser.body.details.alternatives)).toBe(true);
    expect(loser.body.details.alternatives.every((a) => a.starts_at !== slots[3])).toBe(true);

    state.racerAppt = results.find((r) => r.status === 201).body.appointment.id;
  });

  it('the taken time no longer appears as free', async () => {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(slots[3]));
    const res = await api('get', `/availability?service_id=${SERVICE}&staff_id=${DOCTOR}&date=${day}`);

    expect(res.body.slots.map((s) => new Date(s.starts_at).getTime())).not.toContain(new Date(slots[3]).getTime());
  });
});

describe('personal code sign-in', () => {
  it('signs in with the code from the email', async () => {
    const res = await api('post', '/auth/code', { body: { code: state.monaCode.toLowerCase().replace('-', ' ') } });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.user.role).toBe('patient');
  });

  it('refuses an unknown code', async () => {
    const res = await api('post', '/auth/code', { body: { code: 'AAAA-AAAA' } });
    expect(res.status).toBe(401);
  });
});

describe('patient self-service', () => {
  it('lists own upcoming bookings', async () => {
    const res = await api('get', '/me/appointments?scope=upcoming', { token: state.mona.access_token });

    expect(res.status).toBe(200);
    expect(res.body.data.map((a) => a.id)).toEqual(expect.arrayContaining([state.monaAppt, state.monaSecondAppt]));
  });

  it("cannot see someone else's booking (looks like it doesn't exist)", async () => {
    const res = await api('get', `/me/appointments/${state.racerAppt}`, { token: state.mona.access_token });
    expect(res.status).toBe(404);
  });

  it('reschedules own booking to another free time', async () => {
    const res = await api('post', `/me/appointments/${state.monaAppt}/reschedule`, {
      token: state.mona.access_token,
      body: { starts_at: slots[4] },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(new Date(res.body.starts_at).getTime()).toBe(new Date(slots[4]).getTime());
  });

  it('rescheduling into a taken time offers alternatives', async () => {
    const res = await api('post', `/me/appointments/${state.monaAppt}/reschedule`, {
      token: state.mona.access_token,
      body: { starts_at: slots[3] },
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('slot_taken');
    expect(res.body.details.alternatives).toBeDefined();
  });

  it('cancels own booking, and cannot cancel it twice', async () => {
    const first = await api('post', `/me/appointments/${state.monaSecondAppt}/cancel`, {
      token: state.mona.access_token,
      body: { reason: 'Integration test' },
    });
    const second = await api('post', `/me/appointments/${state.monaSecondAppt}/cancel`, { token: state.mona.access_token, body: {} });

    expect(first.status).toBe(200);
    expect(first.body.status).toBe('cancelled');
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('not_cancellable');
  });

  it('may change only the language', async () => {
    const res = await api('patch', '/me', { token: state.mona.access_token, body: { preferred_language: 'ar', full_name: 'Hacker' } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ preferred_language: 'ar', full_name: nameFor('Mona') });
  });
});

describe('phone-only patient booked by staff', () => {
  const walkIn = { full_name: nameFor('Ahmed Walk In'), date_of_birth: '1985-05-05', phone: phoneFor() };

  it('staff book a walk-in with only a phone number', async () => {
    const res = await api('post', '/staff/appointments', {
      token: team.staff.token,
      key: newKey(),
      body: { service_id: SERVICE, staff_id: DOCTOR, starts_at: slots[5], ...walkIn },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.appointment.source).toBe('dashboard');
    state.walkInAppt = res.body.appointment.id;
  });

  it('the walk-in signs in with phone + name + date of birth', async () => {
    const res = await api('post', '/auth/phone', {
      body: { phone: walkIn.phone, full_name: walkIn.full_name.toUpperCase(), date_of_birth: walkIn.date_of_birth },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.user.role).toBe('patient');
  });

  it('5 wrong tries lock the record, even for the right answer next', async () => {
    for (let i = 0; i < 5; i += 1) {
      await api('post', '/auth/phone', { body: { phone: walkIn.phone, full_name: walkIn.full_name, date_of_birth: '1999-09-09' } });
    }
    const res = await api('post', '/auth/phone', { body: walkIn });

    expect(res.status).toBe(423);
    expect(res.body.error).toBe('account_locked');
  });

  it('staff unlock the record and sign-in works again', async () => {
    const { data: patient } = await admin.from('patients').select('id').eq('phone', walkIn.phone).single();
    const unlock = await api('post', `/staff/patients/${patient.id}/unlock`, { token: team.staff.token });
    const res = await api('post', '/auth/phone', { body: walkIn });

    expect(unlock.status).toBe(200);
    expect(res.status).toBe(200);
  });
});

describe('sessions', () => {
  it('refresh gives a new access token; logout ends the session', async () => {
    const session = await login(team.viewer);
    const refreshed = await api('post', '/auth/refresh', { body: { refresh_token: session.refresh_token } });
    expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200);

    const logout = await api('post', '/auth/logout', { token: refreshed.body.access_token });
    const afterLogout = await api('post', '/auth/refresh', { body: { refresh_token: refreshed.body.refresh_token } });

    expect(logout.status).toBe(204);
    expect(afterLogout.status).toBe(401);
  });
});

describe('viewer: sees everything masked, changes nothing', () => {
  // (No name search here: the viewer only sees shortened names, so a search can't match them.)
  it('sees patient emails masked', async () => {
    const res = await api('get', '/staff/patients?limit=100', { token: team.viewer.token });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const p of res.body.data) {
      if (p.email) expect(p.email).toMatch(/^.\*\*\*@/);
      expect(p.date_of_birth).toBeNull();
    }
  });

  it('is refused every write', async () => {
    const timeOff = await api('post', '/staff/time-off', {
      token: team.viewer.token,
      body: { staff_id: null, starts_at: slots[6], ends_at: slots[7] },
    });
    const settings = await api('patch', '/admin/settings', { token: team.viewer.token, body: { min_lead_minutes: 1 } });

    expect(timeOff.status).toBe(403);
    expect(settings.status).toBe(403);
  });

  it('can read the admin screens', async () => {
    expect((await api('get', '/admin/services', { token: team.viewer.token })).status).toBe(200);
    expect((await api('get', '/admin/audit-log', { token: team.viewer.token })).status).toBe(200);
  });
});

describe('staff dashboard', () => {
  it('sees full patient details and can add a note', async () => {
    const search = await api('get', `/staff/patients?q=${encodeURIComponent(emailFor('mona'))}`, { token: team.staff.token });
    const mona = search.body.data[0];
    expect(mona.email).toBe(emailFor('mona'));

    const res = await api('patch', `/staff/patients/${mona.id}`, { token: team.staff.token, body: { notes: 'Prefers mornings' } });
    expect(res.status).toBe(200);
    expect(res.body.notes).toBe('Prefers mornings');
  });

  it('lists the day and refuses to close a booking that has not started', async () => {
    const list = await api('get', `/staff/appointments?status=booked&limit=100&from=${encodeURIComponent(new Date().toISOString())}`, {
      token: team.staff.token,
    });
    expect(list.status).toBe(200);
    expect(list.body.data.map((a) => a.id)).toContain(state.walkInAppt);

    const close = await api('patch', `/staff/appointments/${state.walkInAppt}/status`, { token: team.staff.token, body: { status: 'completed' } });
    expect(close.status).toBe(409);
    expect(close.body.error).toBe('not_started');
  });

  it('adds clinic-wide time off, is told how many bookings clash, then removes it', async () => {
    const res = await api('post', '/staff/time-off', {
      token: team.staff.token,
      body: { staff_id: null, starts_at: slots[5], ends_at: new Date(new Date(slots[5]).getTime() + 3_600_000).toISOString(), reason: 'IT test' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.clashing_bookings).toBeGreaterThanOrEqual(1); // the walk-in booking
    tracked.timeOff.push(res.body.time_off.id);

    const removed = await api('delete', `/staff/time-off/${res.body.time_off.id}`, { token: team.staff.token });
    expect(removed.status).toBe(204);
  });

  it('cancels a booking for a patient', async () => {
    const res = await api('post', `/staff/appointments/${state.walkInAppt}/cancel`, { token: team.staff.token, body: { reason: 'Called in' } });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  it('resolves an escalation once', async () => {
    const { data } = await admin.from('escalations').insert({ reason: `IT ${RUN} test escalation`, urgency: 'low' }).select('id').single();
    tracked.escalations.push(data.id);

    const first = await api('post', `/staff/escalations/${data.id}/resolve`, { token: team.staff.token });
    const second = await api('post', `/staff/escalations/${data.id}/resolve`, { token: team.staff.token });

    expect(first.status).toBe(200);
    expect(first.body.status).toBe('resolved');
    expect(second.status).toBe(409);
  });

  it("can't touch the owner's settings", async () => {
    expect((await api('post', '/admin/services', { token: team.staff.token, body: {} })).status).toBe(403);
  });

  it('reads today’s numbers', async () => {
    const res = await api('get', '/staff/stats/today', { token: team.staff.token });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('bookings_made');
  });
});

describe('owner administration', () => {
  it('creates, reprices and deactivates a service — and the audit log names the owner', async () => {
    const created = await api('post', '/admin/services', {
      token: team.owner.token,
      body: { slug: `it-${RUN}-deep-clean`, name_en: 'IT deep clean', name_ar: 'تنظيف عميق', duration_minutes: 45, price_egp: 900 },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id;

    const repriced = await api('patch', `/admin/services/${id}`, { token: team.owner.token, body: { price_egp: 950 } });
    expect(repriced.body.price_egp).toBe(950);

    const audit = await api('get', `/admin/audit-log?entity=services&entity_id=${id}`, { token: team.owner.token });
    expect(audit.body.data.some((row) => row.actor_id === team.owner.id && row.action === 'services.update')).toBe(true);

    const removed = await api('delete', `/admin/services/${id}`, { token: team.owner.token });
    expect(removed.body.is_active).toBe(false);
    expect((await api('get', `/services/it-${RUN}-deep-clean`)).status).toBe(404);
  });

  it('adds a doctor and sets services and weekly hours all-or-nothing', async () => {
    const doctor = await api('post', '/admin/doctors', {
      token: team.owner.token,
      body: { full_name_en: `IT ${RUN} Dr Test`, full_name_ar: 'د. اختبار', title: 'dentist' },
    });
    expect(doctor.status, JSON.stringify(doctor.body)).toBe(201);
    tracked.staff.push(doctor.body.id);

    const services = await api('put', `/admin/doctors/${doctor.body.id}/services`, { token: team.owner.token, body: { service_ids: [SERVICE] } });
    expect(services.status, JSON.stringify(services.body)).toBe(200);
    expect(services.body.service_ids).toEqual([SERVICE]);

    const hours = await api('put', `/admin/doctors/${doctor.body.id}/working-hours`, {
      token: team.owner.token,
      body: { hours: [{ weekday: 0, start_time: '09:00', end_time: '13:00' }, { weekday: 0, start_time: '14:00', end_time: '17:00' }] },
    });
    expect(hours.status, JSON.stringify(hours.body)).toBe(200);
    expect(hours.body.working_hours).toHaveLength(2);

    const overlap = await api('put', `/admin/doctors/${doctor.body.id}/working-hours`, {
      token: team.owner.token,
      body: { hours: [{ weekday: 1, start_time: '09:00', end_time: '13:00' }, { weekday: 1, start_time: '12:00', end_time: '15:00' }] },
    });
    expect(overlap.status).toBe(422);
    expect(overlap.body.error).toBe('overlapping_shifts');
    const { count } = await admin.from('working_hours').select('id', { count: 'exact', head: true }).eq('staff_id', doctor.body.id);
    expect(count).toBe(2); // the refused change left the old week untouched

    const removed = await api('delete', `/admin/doctors/${doctor.body.id}`, { token: team.owner.token });
    expect(removed.body.is_active).toBe(false);
  });

  it('changes a booking rule and the change is visible publicly', async () => {
    const res = await api('patch', '/admin/settings', { token: team.owner.token, body: { cancellation_window_hours: 48 } });
    expect(res.status).toBe(200);

    const clinic = await api('get', '/clinic');
    expect(clinic.body.booking_rules.cancellation_window_hours).toBe(48);
    // cleanup restores the original value
  });

  it('manages a team member: create, change role, disable, enable', async () => {
    const created = await api('post', '/admin/team', {
      token: team.owner.token,
      body: { email: emailFor('newstaff'), full_name: nameFor('New Staff'), role: 'staff' },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const member = created.body.member;
    const credentials = { email: emailFor('newstaff'), password: created.body.temporary_password };
    expect((await api('post', '/auth/staff/login', { body: credentials })).status).toBe(200);

    const role = await api('patch', `/admin/team/${member.id}/role`, { token: team.owner.token, body: { role: 'viewer' } });
    expect(role.body.role).toBe('viewer');

    await api('post', `/admin/team/${member.id}/disable`, { token: team.owner.token });
    const blocked = await api('post', '/auth/staff/login', { body: credentials });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('account_disabled');

    await api('post', `/admin/team/${member.id}/enable`, { token: team.owner.token });
    expect((await api('post', '/auth/staff/login', { body: credentials })).status).toBe(200);
  });

  it('cannot lock itself out', async () => {
    const res = await api('post', `/admin/team/${team.owner.id}/disable`, { token: team.owner.token });
    expect(res.status).toBe(403);
  });

  it('sees the emails the system sent', async () => {
    const res = await api('get', '/admin/notifications?template=booking_confirmed', { token: team.owner.token });

    expect(res.status).toBe(200);
    expect(res.body.data.some((n) => n.to_address === emailFor('mona') && n.status === 'sent')).toBe(true);
  });
});
