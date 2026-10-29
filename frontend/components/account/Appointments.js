'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { localePath } from '@/i18n/config';
import { useSession } from '@/components/providers/SessionProvider';
import TimePicker from '@/components/book/TimePicker';
import styles from './Account.module.css';

const CLINIC_TZ = 'Africa/Cairo';
const PAGE = 10;

/**
 * My appointments: upcoming visits (cancel or change the time) and past visits.
 * Changes close `windowHours` before the visit (clinic setting); the button explains why instead of
 * failing. The API checks the same rule again, so the lock can't be bypassed.
 */
export default function Appointments({ t, bookWords, locale, windowHours }) {
  const { api } = useSession();
  const [upcoming, setUpcoming] = useState(null);
  const [past, setPast] = useState({ items: null, total: 0 });
  const [open, setOpen] = useState(null); // { id, mode: 'cancel' | 'move' }
  const [picked, setPicked] = useState(null);
  const [note, setNote] = useState(null); // { id, kind, text }
  const [working, setWorking] = useState(false);

  const loadPast = useCallback(
    async (offset = 0) => {
      const page = await api(`/me/appointments?scope=past&limit=${PAGE}&offset=${offset}`);
      setPast((p) => ({ items: offset ? [...(p.items ?? []), ...page.data] : page.data, total: page.meta.total }));
    },
    [api],
  );
  // "locked" = inside the change window; worked out once per load (it depends on the clock)
  const fetchUpcoming = useCallback(
    () =>
      api('/me/appointments?scope=upcoming&limit=50').then((page) =>
        page.data.map((a) => ({ ...a, locked: new Date(a.starts_at).getTime() - Date.now() < windowHours * 3_600_000 })),
      ),
    [api, windowHours],
  );
  const loadUpcoming = useCallback(async () => setUpcoming(await fetchUpcoming()), [fetchUpcoming]);

  useEffect(() => {
    fetchUpcoming()
      .then(setUpcoming)
      .catch(() => setUpcoming([]));
    api(`/me/appointments?scope=past&limit=${PAGE}&offset=0`)
      .then((page) => setPast({ items: page.data, total: page.meta.total }))
      .catch(() => setPast({ items: [], total: 0 }));
  }, [api, fetchUpcoming]);

  async function act(appointment, request, success) {
    setWorking(true);
    setNote(null);
    try {
      await request();
      setOpen(null);
      setPicked(null);
      setNote({ id: appointment.id, kind: 'info', text: success });
      await Promise.all([loadUpcoming(), loadPast()]);
    } catch (err) {
      setNote({ id: appointment.id, kind: 'error', text: err.message });
    } finally {
      setWorking(false);
    }
  }

  const tag = locale === 'ar' ? 'ar-EG' : 'en-US';
  const fmt = (iso, options) => new Intl.DateTimeFormat(tag, { timeZone: CLINIC_TZ, ...options }).format(new Date(iso));
  const name = (record, field) => record?.[`${field}_${locale}`] ?? record?.[`${field}_en`] ?? '';

  const card = (a, isUpcoming) => {
    const locked = Boolean(a.locked);
    const changeable = isUpcoming && a.status === 'booked';
    const mode = open?.id === a.id ? open.mode : null;
    return (
      <li key={a.id} className={`${styles.visit} ${mode ? styles.visitOpen : ''}`}>
        <div className={styles.date} aria-hidden="true">
          <strong>{fmt(a.starts_at, { day: 'numeric' })}</strong>
          <small>{fmt(a.starts_at, { month: 'short' })}</small>
        </div>
        <div className={styles.visitMain}>
          <p className={styles.visitWhen}>
            {fmt(a.starts_at, { weekday: 'long' })} · {fmt(a.starts_at, { hour: 'numeric', minute: '2-digit', hour12: true })}
          </p>
          <p className={styles.visitWhat}>
            {name(a.service, 'name')} <span>{t.with.replace('{doctor}', name(a.doctor, 'full_name'))}</span>
          </p>
          {note?.id === a.id && <p className={note.kind === 'error' ? styles.error : styles.success}>{note.text}</p>}

          {changeable && locked && <p className={styles.muted}>{t.locked.replace('{hours}', windowHours.toLocaleString(tag))}</p>}
          {changeable && !locked && !mode && (
            <div className={styles.actions}>
              <button type="button" onClick={() => (setOpen({ id: a.id, mode: 'move' }), setPicked(null), setNote(null))}>
                {t.move}
              </button>
              <button type="button" className={styles.danger} onClick={() => (setOpen({ id: a.id, mode: 'cancel' }), setNote(null))}>
                {t.cancel}
              </button>
            </div>
          )}
          {mode === 'cancel' && (
            <div className={styles.confirm}>
              <p>{t.confirmCancel}</p>
              <div className={styles.actions}>
                <button type="button" className={styles.dangerSolid} disabled={working} onClick={() => act(a, () => api(`/me/appointments/${a.id}/cancel`, { method: 'POST', body: {} }), t.cancelledNote)}>
                  {t.yesCancel}
                </button>
                <button type="button" onClick={() => setOpen(null)}>
                  {t.keep}
                </button>
              </div>
            </div>
          )}
          {mode === 'move' && (
            <div className={styles.confirm}>
              <p>{t.pickNew}</p>
              <TimePicker serviceId={a.service.id} staffId={a.doctor.id} locale={locale} t={bookWords} picked={picked} onPick={setPicked} />
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={!picked || working}
                  onClick={() =>
                    act(a, () => api(`/me/appointments/${a.id}/reschedule`, { method: 'POST', body: { starts_at: picked.starts_at, staff_id: picked.staff_id } }), t.moved)
                  }
                >
                  {t.saveMove}
                </button>
                <button type="button" onClick={() => setOpen(null)}>
                  {t.keep}
                </button>
              </div>
            </div>
          )}
        </div>
        <span className={`${styles.status} ${styles[a.status] ?? ''}`}>{t.status[a.status] ?? a.status}</span>
      </li>
    );
  };

  return (
    <div className={styles.stack}>
      <section>
        <div className={styles.sectionHead}>
          <h2>{t.upcoming}</h2>
          <Link className={styles.primaryLink} href={localePath(locale, '/book')}>
            {t.book}
          </Link>
        </div>
        {upcoming === null ? <Skeleton /> : upcoming.length === 0 ? <p className={styles.empty}>{t.none}</p> : <ul className={styles.list}>{upcoming.map((a) => card(a, true))}</ul>}
      </section>

      <section>
        <h2>{t.past}</h2>
        {past.items === null ? (
          <Skeleton />
        ) : past.items.length === 0 ? (
          <p className={styles.empty}>{t.nonePast}</p>
        ) : (
          <>
            <ul className={styles.list}>{past.items.map((a) => card(a, false))}</ul>
            {past.items.length < past.total && (
              <button type="button" className={styles.more} onClick={() => loadPast(past.items.length)}>
                {t.more}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Skeleton() {
  return (
    <ul className={styles.list} aria-hidden="true">
      {[0, 1].map((i) => (
        <li key={i} className={styles.skeleton} />
      ))}
    </ul>
  );
}
