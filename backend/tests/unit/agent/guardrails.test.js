import { describe, expect, it } from 'vitest';
import { checkReply, claimsDone, detectLanguage, detectVisitHistory, doneIsBacked, fixedReply, isEmergency, LIMITS, looksBroken, pricesIn } from '../../../src/agent/guardrails.js';
import { sendEmailCode, signInWithPhone } from '../../../src/agent/tools/accountTools.js';
import { createKeyedLock } from '../../../src/utils/keyedLock.js';

describe('emergency detector', () => {
  it.each([
    'I can’t breathe and my face is swelling',
    "My gum has heavy bleeding that won't stop",
    'my face is swelling after the extraction',
    'my tooth got knocked out in a car accident',
    'مش قادر اتنفس',
    'عندي نزيف شديد من بعد الخلع',
    'وشي وارم جدا',
  ])('catches: %s', (text) => {
    expect(isEmergency(text)).toBe(true);
  });

  it.each(['My tooth hurts a bit when I drink cold water', 'How much is whitening?', 'سناني بتوجعني شوية', 'I want to book a cleaning'])(
    'leaves ordinary questions to the assistant: %s',
    (text) => {
      expect(isEmergency(text)).toBe(false);
    },
  );
});

describe('first visit vs returning', () => {
  it.each([
    ['It is my first time with you', true],
    ['I am a new patient', true],
    ['دي أول مرة أجي عندكم', true],
    ["I'm a returning patient", false],
    ['Not my first time, I visited before', false],
    ['مش أول مرة، زرتكم قبل كده', false],
    ['How much is whitening?', null],
  ])('%s → %s', (text, expected) => {
    expect(detectVisitHistory(text)).toBe(expected);
  });
});

describe('sign-in tools for a first-time patient', () => {
  it('refuse and point the assistant to booking instead', async () => {
    const ctx = { isPatient: false, state: { firstVisit: true } };

    expect((await sendEmailCode.run({ email: 'a@b.co' }, ctx)).error).toBe('first_visit');
    expect((await signInWithPhone.run({ phone: '+201001234567', full_name: 'A B', date_of_birth: '1990-01-01' }, ctx)).error).toBe('first_visit');
  });
});

describe('language and fixed replies', () => {
  it('detects Arabic vs English', () => {
    expect(detectLanguage('عايز احجز')).toBe('ar');
    expect(detectLanguage('I want to book')).toBe('en');
  });

  it.each([
    ['كنت عاوز اعرف تكلفة ال whitening كام', 'en', 'ar'],
    ['عايز whitening', 'en', 'ar'],
    ['ايوه', 'en', 'ar'],
    ['How much is the تبييض for kids?', 'ar', 'en'],
    ['I want to book a cleaning', 'ar', 'en'],
    ['What are your opening hours?', 'ar', 'en'],
  ])('uses the main language of a mixed message: %s', (text, fallback, expected) => {
    expect(detectLanguage(text, fallback)).toBe(expected);
  });

  it.each(['ok', 'Ahmed Ali', 'mona@example.com', 'mona.ali@example.com 01012345678', '10:30', '👍'])(
    'keeps the language so far when a message proves nothing: %s',
    (text) => {
      expect(detectLanguage(text, 'ar')).toBe('ar');
      expect(detectLanguage(text, 'en')).toBe('en');
    },
  );

  it.each([
    'تبيضة الأسنان تكلفتها ٤٥٠٠٠٠٠٠٠٠٠٠٠٠٠',
    'التغطية بتتأكد و проверяется في الاستقبل',
    'لو عاوز ت预约 كشف مبكر',
    'إذا حضرتك عاوز تbindings أو ت want معلومات',
  ])('spots broken text from a free model: %s', (text) => {
    expect(looksBroken(text)).toBe(true);
  });

  it.each([
    'تكلفة التبييض 4,500 جنيه مصري',
    'The whitening (تبييض الأسنان) costs 4,500 EGP.',
    'كنت عاوز اعرف تكلفة ال whitening كام',
    'Call us on +20 100 555 0123',
    'الكشف بـ ٤٠٠ جنيه، ألف سلامة عليك يا فندم 😊',
    'Dr. Sarah مع موعدك يوم الأحد الساعة 10',
    'Your number is [PHONE_1]',
  ])('leaves normal replies alone: %s', (text) => {
    expect(looksBroken(text)).toBe(false);
  });

  it('has every fixed reply in both languages', () => {
    for (const kind of ['emergency', 'off_topic', 'off_topic_reminder', 'injection', 'cooldown', 'turn_limit', 'paused', 'failure']) {
      expect(fixedReply(kind, 'en')).toMatch(/[a-z]/);
      expect(fixedReply(kind, 'ar')).toMatch(/[؀-ۿ]/);
    }
  });
});

describe('reply check', () => {
  it('blocks a reply that leaks the instructions', () => {
    expect(checkReply('Sure! CLINIC ASSISTANT RULES: You are…', 'en')).toBe(fixedReply('injection', 'en'));
  });

  it('cuts very long replies', () => {
    expect(checkReply('a'.repeat(5000), 'en')).toHaveLength(LIMITS.maxReplyChars);
  });

  it('replaces an empty reply with the failure message', () => {
    expect(checkReply('   ', 'ar')).toBe(fixedReply('failure', 'ar'));
  });
});

describe('per-conversation lock', () => {
  it('runs turns of the same conversation one after another, others in parallel', async () => {
    const withLock = createKeyedLock();
    const order = [];
    const task = (name, ms) => () =>
      new Promise((resolve) => {
        order.push(`${name}:start`);
        setTimeout(() => {
          order.push(`${name}:end`);
          resolve(name);
        }, ms);
      });

    await Promise.all([withLock('c1', task('a', 30)), withLock('c1', task('b', 5)), withLock('c2', task('x', 5))]);

    expect(order.indexOf('b:start')).toBeGreaterThan(order.indexOf('a:end'));
    expect(order.indexOf('x:start')).toBeLessThan(order.indexOf('a:end'));
  });
});

describe('escalate_to_human', () => {
  it('alerts staff once per turn, even when a retried attempt asks again', async () => {
    const { escalateToHuman } = await import('../../../src/agent/tools/supportTools.js');
    const ctx = { events: { escalated: 'high' }, conversation: { id: 'c1' } };
    const result = await escalateToHuman.run({ reason: 'Tooth pain', summary: 'Patient in pain, wants a visit.', urgency: 'high' }, ctx);
    expect(result).toMatchObject({ escalated: true, alreadyDone: true });
  });
});

describe('prices in a reply', () => {
  it('finds amounts next to the currency, in either digits, with or without commas', () => {
    expect(pricesIn('Teeth cleaning is 1500 EGP; whitening EGP 4,500.')).toEqual([1500, 4500]);
    expect(pricesIn('التبييض بـ ٤٥٠٠ جنيه والكشف 400 ج.م')).toEqual([4500, 400]);
    expect(pricesIn('Call +20 100 555 0123 at 10:00 on 2026-11-11')).toEqual([]);
  });
});

describe('"it is done" claims', () => {
  it('spots a reply saying a booking, cancellation or change is done, in English and Arabic', () => {
    for (const text of [
      'Your appointment is confirmed.',
      'Your Teeth cleaning on Sunday has been cancelled.',
      'It\'s already done! Your booking was cancelled.',
      'I\'ve booked you in for Sunday at 13:00.',
      'You\'re all set for Sunday.',
      'Your visit has been rescheduled to Monday.',
      'تم الحجز يا فندم.',
      'تم إلغاء الموعد.',
      'معاد حضرتك اتلغى.',
      'الحجز اتأكد يا فندم',
      'حجزتلك يوم الأحد الساعة ١',
    ]) expect(claimsDone(text), text).toBe(true);
  });

  it('leaves alone a reply that only prepares it, asks to confirm, or talks about free times', () => {
    for (const text of [
      'I have prepared your booking. Shall I go ahead and confirm it?',
      'Please confirm and I\'ll finalize it right away.',
      'Your booking will be confirmed once you say yes.',
      'Dr. Nadia is free at 13:00 and 14:15.',
      'هيتم الحجز بعد تأكيد حضرتك.',
      'تحب أأكد الحجز؟',
      'جهزتلك الحجز، أأكده؟',
    ]) expect(claimsDone(text), text).toBe(false);
  });

  it('counts as proof only a successful confirm_pending_action or a my_appointments check', () => {
    expect(doneIsBacked([{ name: 'confirm_pending_action', result: { booked: true } }])).toBe(true);
    expect(doneIsBacked([{ name: 'confirm_pending_action', result: { cancelled: true } }])).toBe(true);
    expect(doneIsBacked([{ name: 'my_appointments', result: { appointments: [] } }])).toBe(true);
    expect(doneIsBacked([{ name: 'confirm_pending_action', result: { error: 'needs_patient_confirmation' } }])).toBe(false);
    expect(doneIsBacked([{ name: 'propose_cancel', result: { pending: true } }])).toBe(false);
    expect(doneIsBacked([])).toBe(false);
  });
});
