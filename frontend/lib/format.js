import { intlLocale } from '@/i18n/config';

/**
 * Small formatting helpers shared by pages. They use the browser/Node built-in Intl API, so dates
 * and numbers come out right in both languages (Arabic gets Arabic digits and day names).
 */

/** weekday 0 = Sunday … 6 = Saturday (same numbering as the API). */
function weekdayName(weekday, locale, style = 'short') {
  // 1 Jan 2023 was a Sunday, so day 1 + weekday lands on the right day of the week.
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: style, timeZone: 'UTC' }).format(
    new Date(Date.UTC(2023, 0, 1 + weekday)),
  );
}

/** "10:00" → "10 AM" (English) or "١٠ ص" (Arabic). en-US because en-GB writes "10 am". */
export function formatClock(time, locale) {
  const [hours, minutes] = time.split(':').map(Number);
  return new Intl.DateTimeFormat(locale === 'ar' ? intlLocale(locale) : 'en-US', {
    hour: 'numeric',
    minute: minutes ? '2-digit' : undefined,
    hour12: true,
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2023, 0, 1, hours, minutes)));
}

/**
 * Opening hours from GET /api/clinic → short lines, grouping days with the same hours:
 *   [{ weekday: 6, opens: '10:00', closes: '18:00' }, …] → ['Sat–Thu · 10 AM – 6 PM']
 * The week starts on the day after the first closed day, so "Sat–Thu" reads naturally.
 */
export function summarizeOpeningHours(openingHours, locale) {
  const byDay = new Map(openingHours.map((day) => [day.weekday, day]));
  const firstClosed = [0, 1, 2, 3, 4, 5, 6].find((day) => !byDay.has(day)) ?? 6;
  const week = Array.from({ length: 7 }, (_, i) => (firstClosed + 1 + i) % 7);

  const runs = [];
  for (const day of week) {
    const hours = byDay.get(day);
    const key = hours ? `${hours.opens}-${hours.closes}` : null;
    const last = runs.at(-1);
    if (key && last?.key === key && last.days.at(-1) === week[week.indexOf(day) - 1]) last.days.push(day);
    else if (key) runs.push({ key, days: [day], hours });
  }

  return runs.map(({ days, hours }) => {
    const first = weekdayName(days[0], locale);
    const range = days.length > 1 ? `${first}–${weekdayName(days.at(-1), locale)}` : first;
    return `${range} · ${formatClock(hours.opens, locale)} – ${formatClock(hours.closes, locale)}`;
  });
}
