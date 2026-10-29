'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api/client';
import styles from './Book.module.css';

const CLINIC_TZ = 'Africa/Cairo';

/**
 * Free times for one service (and optionally one doctor) over the next two weeks: day chips, then
 * the times of the chosen day. Used to move a booking on the account page.
 * onPick({ starts_at, staff_id }) fires when a time is chosen.
 */
export default function TimePicker({ serviceId, staffId, locale, t, picked, onPick }) {
  const [days, setDays] = useState(null);
  const [day, setDay] = useState(null);
  const [error, setError] = useState(null);
  const tag = locale === 'ar' ? 'ar-EG' : 'en-US';

  useEffect(() => {
    let cancelled = false;
    apiRequest(`/availability/range?service_id=${serviceId}&days=14${staffId ? `&staff_id=${staffId}` : ''}`)
      .then(({ doctors }) => {
        if (cancelled) return;
        const byDay = new Map();
        for (const d of doctors) {
          for (const { date, slots } of d.days) {
            const list = byDay.get(date) ?? [];
            for (const s of slots) if (!list.some((x) => x.starts_at === s.starts_at)) list.push({ starts_at: s.starts_at, staff_id: d.staff_id });
            byDay.set(date, list);
          }
        }
        const merged = [...byDay.entries()]
          .filter(([, slots]) => slots.length)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, slots]) => ({ date, slots: slots.sort((a, b) => a.starts_at.localeCompare(b.starts_at)) }));
        setDays(merged);
        setDay(merged[0]?.date ?? null);
      })
      .catch((err) => !cancelled && (setDays([]), setError(err.message)));
    return () => {
      cancelled = true;
    };
  }, [serviceId, staffId]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (days === null) {
    return (
      <p className={styles.loading}>
        <span className={styles.spinner} aria-hidden="true" /> {t.loadingTimes}
      </p>
    );
  }
  if (days.length === 0) return <p className={styles.muted}>{t.noTimes}</p>;

  const part = (date, options) => new Intl.DateTimeFormat(tag, { timeZone: 'UTC', ...options }).format(new Date(`${date}T12:00:00Z`));
  return (
    <div>
      <p className={styles.label}>{t.pickDay}</p>
      <div className={styles.days}>
        {days.map(({ date }) => (
          <button key={date} type="button" aria-pressed={date === day} onClick={() => setDay(date)}>
            <small>{part(date, { weekday: 'short' })}</small>
            <strong>{part(date, { day: 'numeric' })}</strong>
            <small>{part(date, { month: 'short' })}</small>
          </button>
        ))}
      </div>
      <p className={styles.label}>{t.pickTime}</p>
      <div className={styles.times}>
        {days
          .find((d) => d.date === day)
          ?.slots.map((s, i) => (
            <button key={s.starts_at} type="button" style={{ '--i': i }} aria-pressed={picked?.starts_at === s.starts_at} onClick={() => onPick(s)}>
              {new Intl.DateTimeFormat(tag, { timeZone: CLINIC_TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(s.starts_at))}
            </button>
          ))}
      </div>
    </div>
  );
}
