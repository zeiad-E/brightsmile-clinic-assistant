import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Step 5 background work: appointment reminders, the waitlist, the nightly clean-up. */

const store = { appointment: null, waiting: [], slots: {}, notified: [], booked: [], enqueued: [], created: [] };

vi.mock('../../src/db/supabase.js', () => ({ requireAdmin: () => ({}), supabaseAdmin: {} }));
vi.mock('../../src/services/catalogService.js', () => ({
  clinicBranding: vi.fn(async () => ({ timeZone: 'Africa/Cairo', phone: '+20 2 1234 5678', cancellationWindowHours: 24 })),
  clinicNameIn: () => 'BrightSmile',
}));
vi.mock('../../src/services/email/emailService.js', () => ({
  PLACEHOLDER_EMAIL_DOMAIN: 'patients.brightsmile.app',
  isPlaceholderEmail: (a) => String(a).endsWith('@patients.brightsmile.app'),
  sendEmail: vi.fn(async () => ({ sent: true })),
}));
vi.mock('../../src/models/appointmentModel.js', () => ({ findForNotification: vi.fn(async () => store.appointment) }));
vi.mock('../../src/models/maintenanceModel.js', () => ({
  queueDueReminders: vi.fn(async () => 2),
  purgeExpiredConversations: vi.fn(async () => 0),
}));
vi.mock('../../src/models/availabilityModel.js', () => ({
  slotsFor: vi.fn(async (_db, { serviceId }) => (store.slots[serviceId] ?? []).map((t) => ({ slot_start: t }))),
}));
vi.mock('../../src/models/staffModel.js', () => ({ findById: vi.fn(async () => ({ full_name_en: 'Dr. Sarah', full_name_ar: 'د. سارة' })) }));
vi.mock('../../src/models/jobModel.js', () => ({
  enqueue: vi.fn(async (_db, job) => store.enqueued.push(job)),
  deleteFinished: vi.fn(async () => 3),
}));
vi.mock('../../src/models/waitlistModel.js', () => ({
  listActiveForPatient: vi.fn(async () => store.waiting),
  listActiveForDay: vi.fn(async () => store.waiting),
  create: vi.fn(async (_db, row) => {
    store.created.push(row);
    return { id: 'w-new', service: { name_en: 'Teeth cleaning' }, date_from: row.dateFrom, date_to: row.dateTo };
  }),
  markNotified: vi.fn(async (_db, ids) => store.notified.push(...ids)),
  markBooked: vi.fn(async (_db, args) => store.booked.push(args)),
  expirePast: vi.fn(async () => 4),
}));

const { sendEmail } = await import('../../src/services/email/emailService.js');
const maintenanceModel = await import('../../src/models/maintenanceModel.js');
const reminders = await import('../../src/services/reminderService.js');
const waitlist = await import('../../src/services/waitlistService.js');
const retention = await import('../../src/services/retentionService.js');
const { renderEmail } = await import('../../src/services/email/templates.js');
const { nextClockTime } = await import('../../src/utils/clinicTime.js');

const HOUR = 3_600_000;
const inHours = (h) => new Date(Date.now() + h * HOUR).toISOString();

const patient = (id, extra = {}) => ({ id, full_name: `Patient ${id}`, email: `${id}@example.com`, preferred_language: 'en', ...extra });
const wish = (id, serviceId, extra = {}) => ({
  id,
  service_id: serviceId,
  staff_id: null,
  date_from: '2026-11-01',
  date_to: '2026-11-30',
  notified_at: null,
  service: { name_en: serviceId, name_ar: serviceId },
  patient: patient(id),
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(store, { appointment: null, waiting: [], slots: {}, notified: [], booked: [], enqueued: [], created: [] });
});

describe('appointment reminders', () => {
  const booking = (startsAt, extra = {}) => ({
    id: 'a1',
    status: 'booked',
    starts_at: startsAt,
    service: { name_en: 'Teeth cleaning', name_ar: 'تنظيف الأسنان' },
    doctor: { full_name_en: 'Dr. Sarah', full_name_ar: 'د. سارة' },
    patient: patient('p1'),
    ...extra,
  });

  it('the sweep asks the database to skip internal placeholder addresses', async () => {
    expect(await reminders.queueDueReminders()).toBe(2);
    expect(maintenanceModel.queueDueReminders).toHaveBeenCalledWith({}, { skipEmailDomain: 'patients.brightsmile.app' });
  });

  it('emails the patient, with the online change deadline while it is still ahead', async () => {
    const startsAt = inHours(40);
    store.appointment = booking(startsAt);

    await reminders.sendReminder({ appointment_id: 'a1', starts_at: startsAt });

    const args = sendEmail.mock.calls[0][0];
    expect(args).toMatchObject({ template: 'appointment_reminder', to: 'p1@example.com', appointmentId: 'a1' });
    expect(new Date(args.data.changeUntil).getTime()).toBe(new Date(startsAt).getTime() - 24 * HOUR);
    expect(args.data.clinicPhone).toBe('+20 2 1234 5678');
  });

  it('says "call the clinic" once the online change window has closed', async () => {
    const startsAt = inHours(10);
    store.appointment = booking(startsAt);

    await reminders.sendReminder({ appointment_id: 'a1', starts_at: startsAt });

    expect(sendEmail.mock.calls[0][0].data.changeUntil).toBeNull();
  });

  it('sends nothing for a booking cancelled or moved since the reminder was queued', async () => {
    store.appointment = booking(inHours(30), { status: 'cancelled' });
    await reminders.sendReminder({ appointment_id: 'a1', starts_at: store.appointment.starts_at });

    store.appointment = booking(inHours(50));
    await reminders.sendReminder({ appointment_id: 'a1', starts_at: inHours(30) });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('throws when the email fails, so the job runner retries it', async () => {
    const startsAt = inHours(30);
    store.appointment = booking(startsAt);
    sendEmail.mockResolvedValueOnce({ sent: false });

    await expect(reminders.sendReminder({ appointment_id: 'a1', starts_at: startsAt })).rejects.toThrow('not sent');
  });
});

describe('reminder and waitlist emails', () => {
  const data = {
    clinicName: 'BrightSmile',
    timeZone: 'Africa/Cairo',
    appUrl: 'https://brightsmile.example',
    clinicPhone: '+20 2 1234 5678',
    patientName: 'Mona <b>',
    startsAt: '2026-12-01T08:00:00Z',
    serviceNameEn: 'Teeth cleaning',
    serviceNameAr: 'تنظيف الأسنان',
    doctorNameEn: 'Dr. Sarah',
    doctorNameAr: 'د. سارة',
  };

  it('reminder: shows the visit in clinic time and where to change it', () => {
    const { subject, text, html } = renderEmail('appointment_reminder', 'en', { ...data, changeUntil: '2026-11-30T08:00:00Z' });

    expect(subject).toBe('Appointment reminder – BrightSmile');
    expect(text).toContain('10:00');
    expect(text).toContain('https://brightsmile.example');
    expect(html).toContain('Mona &lt;b&gt;');
  });

  it('reminder in Arabic, after the change window: right-to-left, asks to call', () => {
    const { html, text } = renderEmail('appointment_reminder', 'ar', { ...data, changeUntil: null });

    expect(html).toContain('dir="rtl"');
    expect(text).toContain('يُرجى الاتصال بالعيادة');
    expect(text).toContain('+20 2 1234 5678');
  });

  it('waitlist: explains first come, first served and how long they wait', () => {
    const { subject, text } = renderEmail('waitlist_slot_open', 'en', { ...data, waitUntil: '2026-12-10' });

    expect(subject).toBe('A time opened up – BrightSmile');
    expect(text).toContain('whoever books first');
    expect(text).toContain('2026-12-10');
  });
});

describe('waitlist: joining', () => {
  const join = (extra = {}) =>
    waitlist.join({ patient: patient('p1'), serviceId: 'clean', dateFrom: '2026-11-01', dateTo: '2026-11-10', ...extra });

  it('adds a wish for a patient with an email', async () => {
    expect(await join()).toMatchObject({ added: true });
    expect(store.created[0]).toMatchObject({ patientId: 'p1', serviceId: 'clean', staffId: null });
  });

  it('refuses without a real email (the waitlist works by email)', async () => {
    expect(await join({ patient: patient('p1', { email: 'x@patients.brightsmile.app' }) })).toMatchObject({ error: 'no_email' });
    expect(await join({ patient: patient('p1', { email: null }) })).toMatchObject({ error: 'no_email' });
  });

  it('does not add the same wish twice, nor more than three at once', async () => {
    store.waiting = [wish('w1', 'clean')];
    expect(await join()).toMatchObject({ error: 'already_waiting' });

    store.waiting = [wish('w1', 'a'), wish('w2', 'b'), wish('w3', 'c')];
    expect(await join()).toMatchObject({ error: 'too_many' });
    expect(store.created).toEqual([]);
  });
});

describe('waitlist: a time opens', () => {
  const freed = '2026-11-05T08:00:00.000Z';

  it('queues a job when a future booking is cancelled, but not for a past one', async () => {
    await waitlist.announceOpening({ serviceId: 'clean', staffId: 'doc', startsAt: inHours(48) });
    await waitlist.announceOpening({ serviceId: 'clean', staffId: 'doc', startsAt: inHours(-2) });

    expect(store.enqueued).toHaveLength(1);
    expect(store.enqueued[0]).toMatchObject({ type: 'waitlist_slot_opened', payload: { service_id: 'clean', staff_id: 'doc' } });
  });

  it('emails only patients whose service fits the freed time, cancelled service first', async () => {
    store.waiting = [wish('w1', 'whitening'), wish('w2', 'clean'), wish('w3', 'implant')];
    store.slots = { clean: [freed], whitening: [freed], implant: [] }; // no room for an implant

    const result = await waitlist.notifyOpening({ service_id: 'clean', staff_id: 'doc', starts_at: freed });

    expect(result.notified).toBe(2);
    expect(sendEmail.mock.calls.map((c) => c[0].to)).toEqual(['w2@example.com', 'w1@example.com']);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ template: 'waitlist_slot_open', data: { doctorNameEn: 'Dr. Sarah', waitUntil: '2026-11-30' } });
    expect(store.notified).toEqual(['w2', 'w1']);
  });

  it('emails nobody when the time was re-booked before the job ran', async () => {
    store.waiting = [wish('w1', 'clean')];
    store.slots = { clean: [] };

    expect((await waitlist.notifyOpening({ service_id: 'clean', staff_id: 'doc', starts_at: freed })).notified).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('emails at most five people, and nobody told in the last 12 hours', async () => {
    store.waiting = [
      wish('recent', 'clean', { notified_at: inHours(-1) }),
      ...Array.from({ length: 7 }, (_, i) => wish(`w${i}`, 'clean', { notified_at: i === 0 ? inHours(-13) : null })),
    ];
    store.slots = { clean: [freed] };

    await waitlist.notifyOpening({ service_id: 'clean', staff_id: 'doc', starts_at: freed });

    expect(store.notified).toEqual(['w0', 'w1', 'w2', 'w3', 'w4']);
  });

  it('marks a wish notified only if its email went out', async () => {
    store.waiting = [wish('w1', 'clean'), wish('w2', 'clean')];
    store.slots = { clean: [freed] };
    sendEmail.mockResolvedValueOnce({ sent: false });

    await waitlist.notifyOpening({ service_id: 'clean', staff_id: 'doc', starts_at: freed });

    expect(store.notified).toEqual(['w2']);
  });
});

describe('nightly clean-up', () => {
  it('purges old chats in batches until a batch comes back short', async () => {
    maintenanceModel.purgeExpiredConversations.mockResolvedValueOnce(500).mockResolvedValueOnce(120);

    const result = await retention.nightlyCleanup();

    expect(maintenanceModel.purgeExpiredConversations).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ chats: 620, waitlist: 4, jobs: 3 });
  });
});

describe('nextClockTime', () => {
  it('finds the next 03:00 in Cairo, today or tomorrow', () => {
    // 2026-11-10 00:30 UTC = 02:30 Cairo (UTC+2): 03:00 is still ahead today.
    expect(nextClockTime('03:00', new Date('2026-11-10T00:30:00Z')).toISOString()).toBe('2026-11-10T01:00:00.000Z');
    // 2026-11-10 12:00 UTC = 14:00 Cairo: the next 03:00 is tomorrow.
    expect(nextClockTime('03:00', new Date('2026-11-10T12:00:00Z')).toISOString()).toBe('2026-11-11T01:00:00.000Z');
  });
});
