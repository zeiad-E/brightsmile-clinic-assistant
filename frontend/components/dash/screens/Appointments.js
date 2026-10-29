'use client';

import Link from 'next/link';
import { useState } from 'react';
import { localePath } from '@/i18n/config';
import { addDays, clinicDateTime, clinicDay, clinicParts, useApiAll, useDash } from '../DashProvider';
import { Button, Card, Empty, Icon, Loaded, PageHead, Segmented, SelectField, StatusBadge, Table, WriteButton } from '../kit';
import { AppointmentDrawer, BookingDrawer, useCatalog } from './shared';
import s from './screens.module.css';

/** The clinic week starts on Saturday (Friday is the weekend in Egypt). */
const weekStart = (day) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 1) % 7));
const toMinutes = (iso) => {
  const [h, m] = clinicParts(iso).time.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Bookings that overlap in time sit side by side: each one takes the first "lane" that is free at
 * its start time, and the day's column is split into as many lanes as were needed.
 */
function sideBySide(dayRows) {
  const laneEnds = [];
  const placed = [...dayRows]
    .sort((x, y) => x.starts_at.localeCompare(y.starts_at))
    .map((a) => {
      let lane = laneEnds.findIndex((end) => end <= a.starts_at);
      if (lane === -1) lane = laneEnds.push(a.ends_at) - 1;
      else laneEnds[lane] = a.ends_at;
      return { a, lane };
    });
  return { placed, lanes: Math.max(1, laneEnds.length) };
}

/**
 * S2 Appointments: a day as a list, or a week as a calendar. Filter by doctor and status; click a
 * booking for its panel (done, no-show, move, cancel); "New booking" for walk-ins and phone calls.
 */
export default function Appointments() {
  const { w, fmt, pick, locale } = useDash();
  const t = w.appointments;
  const [view, setView] = useState('list');
  const [day, setDay] = useState(clinicDay);
  const [staffId, setStaffId] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(null);
  const [booking, setBooking] = useState(false);
  const { doctors } = useCatalog();

  const first = view === 'week' ? weekStart(day) : day;
  const last = view === 'week' ? addDays(first, 6) : day;
  const filters = `${staffId ? `&staff_id=${staffId}` : ''}${status ? `&status=${status}` : ''}`;
  const state = useApiAll(
    `/staff/appointments?from=${encodeURIComponent(clinicDateTime(first))}&to=${encodeURIComponent(clinicDateTime(addDays(last, 1)))}${filters}`,
  );
  const rows = [...(state.data ?? [])].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const step = view === 'week' ? 7 : 1;
  const title =
    view === 'week'
      ? `${fmt.date(`${first}T12:00:00Z`, { day: 'numeric', month: 'short' })} – ${fmt.date(`${last}T12:00:00Z`, { day: 'numeric', month: 'short', year: 'numeric' })}`
      : fmt.date(`${day}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <>
      <PageHead title={w.shell.nav.appointments} sub={t.sub}>
        <WriteButton kind="primary" onClick={() => setBooking(true)}>
          + {t.newBooking}
        </WriteButton>
      </PageHead>

      <div className={s.toolbar}>
        <Segmented value={view} onChange={setView} options={[['list', t.listView], ['week', t.weekView]]} label={t.view} />
        <div className={s.dateNav}>
          <Button size="sm" kind="ghost" onClick={() => setDay((d) => addDays(d, -step))} aria-label={w.common.prev}>
            <span className="flip-rtl">‹</span>
          </Button>
          <strong>{title}</strong>
          <Button size="sm" kind="ghost" onClick={() => setDay((d) => addDays(d, step))} aria-label={w.common.next}>
            <span className="flip-rtl">›</span>
          </Button>
          <Button size="sm" onClick={() => setDay(clinicDay())}>
            {w.common.today}
          </Button>
          <input type="date" className={s.dateInput} value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label={t.pickDate} />
        </div>
        <div className={s.filters}>
          <SelectField label={t.doctor} value={staffId} onChange={setStaffId} options={[['', w.common.all], ...doctors.map((d) => [d.id, pick(d, 'full_name')])]} />
          <SelectField label={t.status} value={status} onChange={setStatus} options={[['', w.common.all], ...['booked', 'completed', 'no_show', 'cancelled'].map((x) => [x, w.status[x]])]} />
        </div>
      </div>

      <Card flush>
        <Loaded state={state} rows={6} empty={rows.length === 0 && view === 'list'} emptyText={t.noneThatDay}>
          {view === 'list' ? (
            <Table
              rows={rows}
              onRow={setOpen}
              columns={[
                { key: 'time', label: t.time, width: 120, render: (a) => <span className={s.mono}>{`${fmt.time(a.starts_at)}–${fmt.time(a.ends_at)}`}</span> },
                {
                  key: 'patient',
                  label: t.patient,
                  render: (a) => (
                    <Link href={localePath(locale, `/dashboard/patients/${a.patient.id}`)} className={s.strongLink} onClick={(e) => e.stopPropagation()}>
                      {a.patient.full_name}
                    </Link>
                  ),
                },
                { key: 'service', label: t.treatment, render: (a) => pick(a.service, 'name') },
                { key: 'doctor', label: t.doctor, hide: 'sm', render: (a) => pick(a.doctor, 'full_name') },
                { key: 'source', label: t.source, hide: 'sm', render: (a) => w.source[a.source] ?? a.source },
                { key: 'status', label: t.status, render: (a) => <StatusBadge status={a.status} /> },
              ]}
            />
          ) : (
            <Week rows={rows} first={first} doctors={doctors} onOpen={setOpen} />
          )}
        </Loaded>
      </Card>

      <AppointmentDrawer appointment={open} onClose={() => setOpen(null)} onChanged={() => (setOpen(null), state.reload())} />
      <BookingDrawer open={booking} onClose={() => setBooking(false)} onBooked={state.reload} />
    </>
  );
}

/** 7 columns (days) × hours. Each booking is a block; its colour shows the status. */
function Week({ rows, first, doctors, onOpen }) {
  const { w, fmt, pick } = useDash();
  const days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
  const today = clinicDay();
  const shifts = doctors.flatMap((d) => d.working_hours);
  const toM = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const from = Math.floor(Math.min(9 * 60, ...shifts.map((h) => toM(h.start_time)), ...rows.map((a) => toMinutes(a.starts_at))) / 60) * 60;
  const to = Math.ceil(Math.max(18 * 60, ...shifts.map((h) => toM(h.end_time)), ...rows.map((a) => toMinutes(a.ends_at))) / 60) * 60;
  const hourPx = 56;
  const hours = Array.from({ length: (to - from) / 60 }, (_, i) => from / 60 + i);
  const doctorIndex = new Map(doctors.map((d, i) => [d.id, i % 4]));

  if (rows.length === 0 && doctors.length === 0) return <Empty title={w.appointments.noneThatWeek} />;
  return (
    <div className={s.weekWrap}>
      <div className={s.week} style={{ '--hour': `${hourPx}px`, '--hours': hours.length }}>
        <div className={s.weekCorner} />
        {days.map((d) => (
          <div key={d} className={s.weekDay} data-today={d === today || undefined}>
            {fmt.date(`${d}T12:00:00Z`, { weekday: 'short', day: 'numeric' })}
          </div>
        ))}
        <div className={s.weekHours}>
          {hours.map((h) => (
            <span key={h}>{fmt.time(clinicDateTime(first, `${String(h).padStart(2, '0')}:00`)).replace(':00', '')}</span>
          ))}
        </div>
        {days.map((d) => {
          const { placed, lanes } = sideBySide(rows.filter((a) => clinicParts(a.starts_at).day === d));
          return (
            <div key={d} className={s.weekCol}>
              {placed.map(({ a, lane }) => {
                const top = ((toMinutes(a.starts_at) - from) / 60) * hourPx;
                const height = Math.max(22, ((toMinutes(a.ends_at) - toMinutes(a.starts_at)) / 60) * hourPx - 2);
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={s.weekBlock}
                    data-status={a.status}
                    data-doctor={doctorIndex.get(a.doctor.id) ?? 0}
                    style={{ top, height, insetInlineStart: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                    onClick={() => onOpen(a)}
                    title={`${fmt.time(a.starts_at)} · ${a.patient.full_name} · ${pick(a.service, 'name')} · ${pick(a.doctor, 'full_name')}`}
                  >
                    <strong>{a.patient.full_name}</strong>
                    <small>
                      {fmt.time(a.starts_at)} · {pick(a.service, 'name')}
                    </small>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className={s.weekLegend}>
        {doctors.map((d, i) => (
          <span key={d.id} data-doctor={i % 4}>
            <Icon name="doctors" size={14} /> {pick(d, 'full_name')}
          </span>
        ))}
      </p>
    </div>
  );
}
