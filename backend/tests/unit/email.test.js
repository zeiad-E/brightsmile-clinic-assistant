import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderEmail } from '../../src/services/email/templates.js';
import { createBrevoAdapter, parseAddress } from '../../src/services/email/adapters/brevo.js';
import { isPlaceholderEmail, sendEmail, setEmailAdapter } from '../../src/services/email/emailService.js';
import { logger } from '../../src/utils/logger.js';

const booking = {
  clinicName: 'BrightSmile',
  timeZone: 'Africa/Cairo',
  patientName: 'Mona <script>alert(1)</script>',
  startsAt: '2026-12-01T08:00:00Z',
  serviceNameEn: 'Teeth cleaning',
  serviceNameAr: 'تنظيف الأسنان',
  doctorNameEn: 'Dr. Sarah',
  doctorNameAr: 'د. سارة',
  personalCode: 'K7Q4-9M2X',
};

describe('templates', () => {
  it('escapes names so they can never inject HTML', () => {
    const { html } = renderEmail('booking_confirmed', 'en', booking);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows the time in the clinic timezone and includes the code', () => {
    const { text, subject } = renderEmail('booking_confirmed', 'en', booking);

    expect(subject).toBe('Booking confirmed – BrightSmile');
    expect(text).toContain('10:00'); // 08:00 UTC = 10:00 in Cairo (winter)
    expect(text).toContain('K7Q4-9M2X');
  });

  it('writes Arabic emails right-to-left', () => {
    const { html, subject } = renderEmail('booking_confirmed', 'ar', booking);

    expect(html).toContain('dir="rtl"');
    expect(subject).toContain('تأكيد الحجز');
    expect(html).toContain('تنظيف الأسنان');
  });
});

describe('emailService', () => {
  afterEach(() => setEmailAdapter(null));

  it('never mails an internal placeholder address', async () => {
    const send = vi.fn();
    setEmailAdapter({ send });

    expect(isPlaceholderEmail('patient-1@patients.brightsmile.app')).toBe(true);
    expect(await sendEmail({ template: 'login_code', to: 'patient-1@patients.brightsmile.app', data: {} })).toMatchObject({ skipped: true });
    expect(send).not.toHaveBeenCalled();
  });

  it('reports a failed send instead of throwing (a booking must never be undone by email)', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    setEmailAdapter({ send: vi.fn(async () => Promise.reject(new Error('SMTP blocked'))) });

    await expect(sendEmail({ template: 'booking_confirmed', to: 'a@b.co', data: booking })).resolves.toEqual({ sent: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('Brevo adapter', () => {
  it('splits "Name <address>"', () => {
    expect(parseAddress('BrightSmile Dental <clinic@gmail.com>')).toEqual({ name: 'BrightSmile Dental', email: 'clinic@gmail.com' });
    expect(parseAddress('clinic@gmail.com')).toEqual({ email: 'clinic@gmail.com' });
  });

  it('calls the Brevo API with the key and message', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    await createBrevoAdapter({ apiKey: 'key-123', from: 'Clinic <c@x.com>', fetchImpl }).send({
      to: 'a@b.co',
      subject: 'Hi',
      text: 'Hello',
      html: '<p>Hello</p>',
    });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(options.headers['api-key']).toBe('key-123');
    expect(JSON.parse(options.body)).toMatchObject({ sender: { email: 'c@x.com' }, to: [{ email: 'a@b.co' }], subject: 'Hi' });
  });

  it('throws on an API error so the notification is marked failed', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }));
    await expect(createBrevoAdapter({ apiKey: 'bad', from: 'c@x.com', fetchImpl }).send({ to: 'a@b.co' })).rejects.toThrow(/401/);
  });
});
