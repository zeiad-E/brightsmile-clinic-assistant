'use client';

import { useEffect, useState } from 'react';
import { formatClock } from '@/lib/format';
import { intlLocale } from '@/i18n/config';
import styles from './About.module.css';

const CLINIC_TZ = 'Africa/Cairo';
const WEEK = [6, 0, 1, 2, 3, 4, 5]; // the clinic's week starts on Saturday

const dayName = (weekday, locale) =>
  new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + weekday)));

/** Today's weekday (0 = Sunday) and "HH:MM", in Cairo time. */
function cairoNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: CLINIC_TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return { weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday), time: `${parts.hour}:${parts.minute}` };
}

/**
 * The opening hours table with a live "Open now / Closed now" badge and today highlighted.
 * A client component because it depends on the visitor's clock (the page itself is built ahead of
 * time, so it can't know "now"). It updates every minute.
 */
export default function VisitHours({ openingHours, locale, t }) {
  const [now, setNow] = useState(null);
  useEffect(() => {
    const tick = () => setNow(cairoNow());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const byDay = new Map(openingHours.map((day) => [day.weekday, day]));
  let badge = null;
  if (now) {
    const today = byDay.get(now.weekday);
    if (today && today.opens <= now.time && now.time < today.closes) {
      badge = { open: true, text: t.openNow.replace('{time}', formatClock(today.closes, locale)) };
    } else {
      // the next opening: later today, or the next day with hours
      for (let ahead = 0; ahead < 8; ahead++) {
        const weekday = (now.weekday + ahead) % 7;
        const day = byDay.get(weekday);
        if (day && (ahead > 0 || now.time < day.opens)) {
          const when = ahead === 0 ? t.today : dayName(weekday, locale);
          badge = { open: false, text: t.closedNow.replace('{day}', when).replace('{time}', formatClock(day.opens, locale)) };
          break;
        }
      }
    }
  }

  return (
    <div>
      <p className={`${styles.badge} ${badge ? '' : styles.badgeHidden} ${badge?.open ? styles.open : ''}`} aria-live="polite">
        <i aria-hidden="true" />
        {badge?.text ?? ' '}
      </p>
      <h3 className={styles.visitLabel}>{t.hours}</h3>
      <ul className={styles.hours}>
        {WEEK.map((weekday) => {
          const day = byDay.get(weekday);
          return (
            <li key={weekday} className={now?.weekday === weekday ? styles.today : ''}>
              <span>{dayName(weekday, locale)}</span>
              <span>{day ? `${formatClock(day.opens, locale)} – ${formatClock(day.closes, locale)}` : t.closed}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
