'use client';

import Link from 'next/link';
import { useState } from 'react';
import { localePath } from '@/i18n/config';
import { clinicDateTime, clinicDay, clinicParts, useApi, useDash, useNow, usePolling } from '../DashProvider';
import { Card, Empty, Loaded, PageHead, Stat, StatusBadge, WriteButton } from '../kit';
import { Donut, HBars } from '../charts';
import { AppointmentDrawer, BookingDrawer, useCatalog } from './shared';
import s from './screens.module.css';

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * S1 Today: the clinic's day at a glance.
 * Counters → a timeline per doctor (with a "now" line) → what's next → the coming week → how the
 * assistant did this week. Refreshes itself every minute.
 */
export default function Today() {
  const { w, fmt, say, pick, user, locale } = useDash();
  const t = w.today;
  const today = clinicDay();
  const stats = useApi('/staff/stats/today');
  const appts = useApi(`/staff/appointments?date=${today}&limit=100`);
  const week = useApi('/staff/stats/upcoming-by-doctor');
  const ai = useApi('/staff/stats/ai-outcomes');
  const { doctors, services } = useCatalog();
  const shortest = [...services].sort((a, b) => a.duration_minutes - b.duration_minutes)[0];
  const free = useApi(shortest ? `/availability/range?service_id=${shortest.id}&days=1` : null);
  const now = useNow();
  const [open, setOpen] = useState(null);
  const [booking, setBooking] = useState(false);

  usePolling(() => {
    stats.reload();
    appts.reload();
    free.reload();
  }, 60_000);

  const list = appts.data?.data ?? [];
  const live = list.filter((a) => a.status !== 'cancelled');
  const done = live.filter((a) => a.status === 'completed').length;
  const noShow = live.filter((a) => a.status === 'no_show').length;
  const toCome = live.filter((a) => a.status === 'booked' && now && new Date(a.starts_at).getTime() > now);
  const freeCount = free.data?.doctors?.reduce((sum, d) => sum + d.days.reduce((n, day) => n + day.slots.length, 0), 0);
  const hour = now ? Number(clinicParts(new Date(now).toISOString()).time.slice(0, 2)) : 12;
  const greeting = hour < 12 ? t.morning : hour < 17 ? t.afternoon : t.evening;
  const firstName = user.full_name?.split(' ').find((x) => !/^(Dr\.|د\.)$/.test(x)) ?? '';

  const reload = () => {
    appts.reload();
    stats.reload();
  };

  return (
    <>
      <PageHead title={say(greeting, { name: firstName })} sub={fmt.date(`${today}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}>
        <Link className={s.linkBtn} href={localePath(locale, '/dashboard/patients')}>
          {t.findPatient}
        </Link>
        <WriteButton kind="primary" onClick={() => setBooking(true)}>
          + {t.newBooking}
        </WriteButton>
      </PageHead>

      <div className={s.stats}>
        <Stat label={t.visits} value={appts.data ? fmt.number(live.length) : '…'} hint={say(t.visitsHint, { done: fmt.number(done), noShow: fmt.number(noShow) })} />
        <Stat label={t.toCome} value={appts.data && now ? fmt.number(toCome.length) : '…'} hint={toCome[0] ? say(t.nextAt, { time: fmt.time(toCome[0].starts_at) }) : t.noneLeft} />
        <Stat
          label={t.freeLeft}
          value={freeCount == null ? '…' : fmt.number(freeCount)}
          hint={shortest ? say(t.freeHint, { minutes: fmt.number(shortest.duration_minutes) }) : ''}
        />
        <Link href={localePath(locale, '/dashboard/inbox')} className={s.statLink}>
          <Stat
            label={t.handovers}
            value={stats.data ? fmt.number(stats.data.open_escalations) : '…'}
            hint={t.handoversHint}
            tone={stats.data?.open_escalations ? 'red' : undefined}
          />
        </Link>
        <Stat
          label={t.newBookings}
          value={stats.data ? fmt.number(stats.data.bookings_made) : '…'}
          hint={stats.data ? say(t.newBookingsHint, { ai: fmt.number(stats.data.ai_bookings), patients: fmt.number(stats.data.new_patients) }) : ''}
        />
      </div>

      <Card title={t.timeline} action={<span className={s.legendInline}>{Object.entries(w.status).filter(([k]) => ['booked', 'completed', 'no_show'].includes(k)).map(([k, v]) => <span key={k} data-status={k}>{v}</span>)}</span>}>
        <Loaded state={appts} rows={3}>
          <Timeline appointments={live} doctors={doctors} day={today} now={now} onOpen={setOpen} />
        </Loaded>
      </Card>

      <div className={s.grid3}>
        <Card title={t.nextUp}>
          <Loaded state={appts} empty={toCome.length === 0} emptyText={t.noneLeft}>
            <ul className={s.nextList}>
              {toCome.slice(0, 6).map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => setOpen(a)}>
                    <time>{fmt.time(a.starts_at)}</time>
                    <span>
                      <strong>{a.patient.full_name}</strong>
                      <small>
                        {pick(a.service, 'name')} · {pick(a.doctor, 'full_name')}
                      </small>
                    </span>
                    <StatusBadge status={a.status} />
                  </button>
                </li>
              ))}
            </ul>
          </Loaded>
        </Card>
        <Card title={t.week}>
          <Loaded state={week} empty={(week.data?.data ?? []).length === 0}>
            <HBars
              data={(week.data?.data ?? []).map((d) => ({ key: d.staff_id, label: pick(d, 'full_name'), value: Number(d.booked_next_7_days) }))}
              format={(n) => fmt.number(n)}
            />
            <p className={s.muted}>{t.weekHint}</p>
          </Loaded>
        </Card>
        <Card title={t.ai}>
          <Loaded state={ai}>
            <AiDonut rows={ai.data?.data ?? []} />
          </Loaded>
        </Card>
      </div>

      <AppointmentDrawer appointment={open} onClose={() => setOpen(null)} onChanged={() => (setOpen(null), reload())} />
      <BookingDrawer open={booking} onClose={() => setBooking(false)} onBooked={reload} />
    </>
  );
}

/** One lane per doctor; each visit is a block placed by its start and length. */
function Timeline({ appointments, doctors, day, now, onOpen }) {
  const { w, fmt, pick } = useDash();
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const working = doctors.filter((d) => d.working_hours.some((h) => h.weekday === weekday) || appointments.some((a) => a.doctor.id === d.id));
  const shifts = working.flatMap((d) => d.working_hours.filter((h) => h.weekday === weekday));
  const starts = [...shifts.map((h) => toMinutes(h.start_time)), ...appointments.map((a) => toMinutes(clinicParts(a.starts_at).time))];
  const ends = [...shifts.map((h) => toMinutes(h.end_time)), ...appointments.map((a) => toMinutes(clinicParts(a.ends_at).time))];
  const from = Math.floor(Math.min(9 * 60, ...starts) / 60) * 60;
  const to = Math.ceil(Math.max(17 * 60, ...ends) / 60) * 60;
  const span = to - from;
  const pos = (minutes) => `${((minutes - from) / span) * 100}%`;
  const hours = Array.from({ length: span / 60 + 1 }, (_, i) => from / 60 + i);
  const nowMinutes = now && clinicParts(new Date(now).toISOString()).day === day ? toMinutes(clinicParts(new Date(now).toISOString()).time) : null;

  if (working.length === 0) return <Empty title={w.today.closedToday} />;
  return (
    <div className={s.timeline}>
      <div className={s.tlHours}>
        <span />
        <div>
          {hours.map((h) => (
            <span key={h} style={{ insetInlineStart: pos(h * 60) }}>
              {fmt.time(clinicDateTime(day, `${String(h).padStart(2, '0')}:00`)).replace(':00', '')}
            </span>
          ))}
        </div>
      </div>
      {working.map((d) => (
        <div key={d.id} className={s.tlLane}>
          <span className={s.tlName}>{pick(d, 'full_name')}</span>
          <div className={s.tlTrack}>
            {d.working_hours
              .filter((h) => h.weekday === weekday)
              .map((h) => (
                <span key={h.start_time} className={s.tlShift} style={{ insetInlineStart: pos(toMinutes(h.start_time)), width: `${((toMinutes(h.end_time) - toMinutes(h.start_time)) / span) * 100}%` }} />
              ))}
            {appointments
              .filter((a) => a.doctor.id === d.id)
              .map((a) => {
                const start = toMinutes(clinicParts(a.starts_at).time);
                const end = toMinutes(clinicParts(a.ends_at).time);
                return (
                  <button
                    key={a.id}
                    type="button"
                    data-status={a.status}
                    className={s.tlBlock}
                    style={{ insetInlineStart: pos(start), width: `${((end - start) / span) * 100}%` }}
                    title={`${fmt.time(a.starts_at)} · ${a.patient.full_name} · ${pick(a.service, 'name')}`}
                    onClick={() => onOpen(a)}
                  >
                    <span>{a.patient.full_name}</span>
                  </button>
                );
              })}
            {nowMinutes != null && nowMinutes >= from && nowMinutes <= to && <span className={s.tlNow} style={{ insetInlineStart: pos(nowMinutes) }} />}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Last 7 days: what share of chats the assistant finished itself vs handed to the team. */
export function AiDonut({ rows }) {
  const { w, fmt, say } = useDash();
  const t = w.today;
  const count = (outcomes) => rows.filter((r) => r.assistant === 'patient' && outcomes.includes(r.outcome)).reduce((sum, r) => sum + Number(r.runs), 0);
  const parts = [
    { key: 'handled', label: t.aiHandled, value: count(['answered', 'booked', 'changed_data']) },
    { key: 'handed', label: t.aiHanded, value: count(['escalated']) },
    { key: 'declined', label: t.aiDeclined, value: count(['refused']) },
    { key: 'failed', label: t.aiFailed, value: count(['fallback', 'error']) },
  ];
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  if (!total) return <Empty title={t.aiNone} />;
  return <Donut parts={parts} center={fmt.percent(parts[0].value / total)} sub={t.aiHandledShort} format={(n) => fmt.number(n)} />;
}

