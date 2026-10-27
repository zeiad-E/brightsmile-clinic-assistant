/**
 * Short "what I'm doing" lines shown to the patient while a turn runs (streaming only).
 * Written by the code, never by the AI, and never naming internal tools.
 */
const TOOL_STATUS = {
  search_knowledge: ['Looking that up…', 'أبحث عن المعلومة…'],
  list_services: ['Checking our treatments…', 'أراجع خدماتنا…'],
  list_doctors: ['Checking our doctors…', 'أراجع أطباءنا…'],
  check_availability: ['Checking free times…', 'أبحث عن المواعيد المتاحة…'],
  propose_booking: ['Preparing your booking…', 'أجهّز الحجز…'],
  propose_cancel: ['Preparing the change…', 'أجهّز التعديل…'],
  propose_reschedule: ['Preparing the change…', 'أجهّز التعديل…'],
  confirm_pending_action: ['Confirming…', 'جاري التأكيد…'],
  my_appointments: ['Checking your bookings…', 'أراجع حجوزاتك…'],
  sign_in_with_phone: ['Checking your details…', 'أتحقق من بياناتك…'],
  sign_in_with_code: ['Checking your details…', 'أتحقق من بياناتك…'],
  send_email_code: ['Sending your code…', 'أرسل الرمز…'],
  verify_email_code: ['Checking your code…', 'أتحقق من الرمز…'],
  join_waitlist: ['Adding you to the waitlist…', 'أضيفك إلى قائمة الانتظار…'],
  escalate_to_human: ['Passing this to our team…', 'أحوّل طلبك لفريق العيادة…'],
};

const THINKING = ['Thinking…', 'لحظة من فضلك…'];
const pick = ([en, ar], language) => (language === 'ar' ? ar : en);

/** A status event for the stream: { stage, text, position? }. */
export function progressEvent({ stage, tool, position }, language) {
  if (stage === 'queued') {
    const text =
      language === 'ar'
        ? `الطلب عليّ كبير الآن، دورك رقم ${position}…`
        : `It's busy right now — you're number ${position} in line…`;
    return { stage, position, text };
  }
  if (stage === 'tool') return { stage, text: pick(TOOL_STATUS[tool] ?? THINKING, language) };
  return { stage: 'thinking', text: pick(THINKING, language) };
}
