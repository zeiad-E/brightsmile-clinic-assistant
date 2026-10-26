import { formatDateTime } from '../../utils/clinicTime.js';

/**
 * Email texts in English and Arabic. Each template returns { subject, text, html }.
 * Every value placed into the HTML is escaped, so a patient named "<script>" stays text.
 *
 * Template names match the notifications.template column:
 * booking_confirmed · booking_cancelled · login_code · welcome · appointment_reminder · waitlist_slot_open
 */
const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

function page(language, lines) {
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  const body = lines.map((line) => `<p style="margin:0 0 12px">${line}</p>`).join('');
  return `<!doctype html><html lang="${language}" dir="${dir}"><body style="font-family:Arial,sans-serif;color:#3A1328;line-height:1.5">${body}</body></html>`;
}

const codeBlock = (code) =>
  `<strong style="font-size:20px;letter-spacing:2px;background:#F9D5DC;padding:4px 10px;border-radius:6px">${escapeHtml(code)}</strong>`;

function bookingDetails(data, language) {
  const when = formatDateTime(data.startsAt, language, data.timeZone);
  const service = language === 'ar' ? data.serviceNameAr : data.serviceNameEn;
  const doctor = language === 'ar' ? data.doctorNameAr : data.doctorNameEn;
  return { when, service, doctor };
}

const TEMPLATES = {
  booking_confirmed: (data, language) => {
    const { when, service, doctor } = bookingDetails(data, language);
    if (language === 'ar') {
      const lines = [
        `مرحباً ${escapeHtml(data.patientName)}،`,
        `تم تأكيد حجزك في ${escapeHtml(data.clinicName)}: ${escapeHtml(service)} مع ${escapeHtml(doctor)}، ${escapeHtml(when)}.`,
        'يمكنك الإلغاء أو تغيير الموعد من حسابك حتى ٢٤ ساعة قبل الموعد.',
      ];
      if (data.personalCode) lines.push(`رمزك الشخصي لتسجيل الدخول: ${codeBlock(data.personalCode)}`, 'احتفظ به ولا تشاركه مع أحد.');
      return {
        subject: `تأكيد الحجز – ${data.clinicName}`,
        text: lines.join('\n').replace(/<[^>]+>/g, ''),
        html: page('ar', lines),
      };
    }
    const lines = [
      `Hi ${escapeHtml(data.patientName)},`,
      `Your booking at ${escapeHtml(data.clinicName)} is confirmed: ${escapeHtml(service)} with ${escapeHtml(doctor)}, ${escapeHtml(when)}.`,
      'You can cancel or reschedule from your account up to 24 hours before.',
    ];
    if (data.personalCode) lines.push(`Your personal sign-in code: ${codeBlock(data.personalCode)}`, 'Keep it private.');
    return {
      subject: `Booking confirmed – ${data.clinicName}`,
      text: lines.join('\n').replace(/<[^>]+>/g, ''),
      html: page('en', lines),
    };
  },

  booking_cancelled: (data, language) => {
    const { when, service } = bookingDetails(data, language);
    const lines =
      language === 'ar'
        ? [`مرحباً ${escapeHtml(data.patientName)}،`, `تم إلغاء حجزك: ${escapeHtml(service)}، ${escapeHtml(when)}.`, 'نتمنى رؤيتك قريباً.']
        : [`Hi ${escapeHtml(data.patientName)},`, `Your booking was cancelled: ${escapeHtml(service)}, ${escapeHtml(when)}.`, 'We hope to see you soon.'];
    return {
      subject: language === 'ar' ? `إلغاء الحجز – ${data.clinicName}` : `Booking cancelled – ${data.clinicName}`,
      text: lines.join('\n').replace(/<[^>]+>/g, ''),
      html: page(language, lines),
    };
  },

  login_code: (data, language) => {
    const lines =
      language === 'ar'
        ? [`رمزك الشخصي الجديد لتسجيل الدخول إلى ${escapeHtml(data.clinicName)}:`, codeBlock(data.personalCode), 'الرمز القديم لم يعد صالحاً.']
        : [`Your new personal sign-in code for ${escapeHtml(data.clinicName)}:`, codeBlock(data.personalCode), 'Your old code no longer works.'];
    return {
      subject: language === 'ar' ? 'رمز تسجيل الدخول' : 'Your sign-in code',
      text: lines.join('\n').replace(/<[^>]+>/g, ''),
      html: page(language, lines),
    };
  },

  welcome: (data, language) => {
    const lines =
      language === 'ar'
        ? [
            `مرحباً ${escapeHtml(data.fullName)}، تمت إضافتك إلى فريق ${escapeHtml(data.clinicName)}.`,
            `البريد: ${escapeHtml(data.email)}`,
            `كلمة المرور المؤقتة: ${codeBlock(data.temporaryPassword)}`,
            `سجّل الدخول من ${escapeHtml(data.appUrl)} وغيّر كلمة المرور فوراً.`,
          ]
        : [
            `Hi ${escapeHtml(data.fullName)}, you've been added to the ${escapeHtml(data.clinicName)} team.`,
            `Email: ${escapeHtml(data.email)}`,
            `Temporary password: ${codeBlock(data.temporaryPassword)}`,
            `Sign in at ${escapeHtml(data.appUrl)} and change your password right away.`,
          ];
    return {
      subject: language === 'ar' ? `مرحباً بك في ${data.clinicName}` : `Welcome to ${data.clinicName}`,
      text: lines.join('\n').replace(/<[^>]+>/g, ''),
      html: page(language, lines),
    };
  },

  // data.changeUntil: the last moment it can be changed online (null once that has passed).
  appointment_reminder: (data, language) => {
    const { when, service, doctor } = bookingDetails(data, language);
    const until = data.changeUntil ? formatDateTime(data.changeUntil, language, data.timeZone) : null;
    let lines;
    if (language === 'ar') {
      lines = [
        `مرحباً ${escapeHtml(data.patientName)}،`,
        `نذكّرك بموعدك في ${escapeHtml(data.clinicName)}: ${escapeHtml(service)} مع ${escapeHtml(doctor)}، ${escapeHtml(when)}.`,
        until
          ? `لتغيير الموعد أو إلغائه، تحدّث مع مساعدنا على ${escapeHtml(data.appUrl)} حتى ${escapeHtml(until)}.`
          : 'لتغيير الموعد أو إلغائه، يُرجى الاتصال بالعيادة.',
      ];
      if (data.clinicPhone) lines.push(`هاتف العيادة: ${escapeHtml(data.clinicPhone)}`);
      lines.push('نراك قريباً!');
    } else {
      lines = [
        `Hi ${escapeHtml(data.patientName)},`,
        `A reminder of your appointment at ${escapeHtml(data.clinicName)}: ${escapeHtml(service)} with ${escapeHtml(doctor)}, ${escapeHtml(when)}.`,
        until
          ? `Need to change or cancel? Chat with our assistant at ${escapeHtml(data.appUrl)} until ${escapeHtml(until)}.`
          : 'Need to change or cancel? Please call the clinic.',
      ];
      if (data.clinicPhone) lines.push(`Clinic phone: ${escapeHtml(data.clinicPhone)}`);
      lines.push('See you soon!');
    }
    return {
      subject: language === 'ar' ? `تذكير بموعدك – ${data.clinicName}` : `Appointment reminder – ${data.clinicName}`,
      text: lines.join('\n').replace(/<[^>]+>/g, ''),
      html: page(language, lines),
    };
  },

  // data.waitUntil: the last day of the patient's waitlist entry ('YYYY-MM-DD').
  waitlist_slot_open: (data, language) => {
    const { when, service, doctor } = bookingDetails(data, language);
    const lines =
      language === 'ar'
        ? [
            `مرحباً ${escapeHtml(data.patientName)}،`,
            `خبر سار: أصبح هناك موعد متاح لـ ${escapeHtml(service)} مع ${escapeHtml(doctor)}، ${escapeHtml(when)}.`,
            `المواعيد لمن يحجز أولاً. احجزه الآن من خلال مساعدنا على ${escapeHtml(data.appUrl)}.`,
            `أنت على قائمة الانتظار حتى ${escapeHtml(data.waitUntil)}.`,
          ]
        : [
            `Hi ${escapeHtml(data.patientName)},`,
            `Good news: a time opened up for ${escapeHtml(service)} with ${escapeHtml(doctor)}, ${escapeHtml(when)}.`,
            `It goes to whoever books first. Book it now with our assistant at ${escapeHtml(data.appUrl)}.`,
            `You are on the waitlist until ${escapeHtml(data.waitUntil)}.`,
          ];
    return {
      subject: language === 'ar' ? `موعد متاح – ${data.clinicName}` : `A time opened up – ${data.clinicName}`,
      text: lines.join('\n').replace(/<[^>]+>/g, ''),
      html: page(language, lines),
    };
  },
};

export function renderEmail(template, language, data) {
  const build = TEMPLATES[template];
  if (!build) throw new Error(`Unknown email template: ${template}`);
  return build(data, language === 'ar' ? 'ar' : 'en');
}
