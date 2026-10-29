'use client';

import { useState } from 'react';
import { addDays, clinicDateTime, clinicDay, clinicParts, useAction, useApiAll, useDash } from '../DashProvider';
import { Badge, Button, Card, Confirm, Drawer, FormGrid, Icon, Loaded, Notice, PageHead, Segmented, SelectField, Table, TextField, Toggle, WriteButton } from '../kit';
import { useCatalog } from './shared';
import s from './screens.module.css';

/**
 * S6 Time off: holidays and blocked hours, for one doctor or the whole clinic. The booking system
 * never offers those times. Adding time off doesn't cancel bookings already made in it: the screen
 * says how many there are, so a person can call those patients.
 */
export default function TimeOff() {
  const { w, fmt, pick, say, can, api } = useDash();
  const t = w.timeOff;
  const today = clinicDay();
  const [when, setWhen] = useState('upcoming');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [editing, setEditing] = useState(null); // {} = new, row = edit
  const [removing, setRemoving] = useState(null);
  const [clash, setClash] = useState(null);
  const [run, busy] = useAction();
  const { doctors } = useCatalog();
  const range = when === 'upcoming' ? `from=${encodeURIComponent(clinicDateTime(today))}` : `from=${encodeURIComponent(clinicDateTime(addDays(today, -365)))}&to=${encodeURIComponent(clinicDateTime(today))}`;
  const state = useApiAll(`/staff/time-off?${range}`);
  const rows = [...(state.data ?? [])].sort((a, b) => (when === 'upcoming' ? a.starts_at.localeCompare(b.starts_at) : b.starts_at.localeCompare(a.starts_at)));
  const name = (staffId) => (staffId ? pick(doctors.find((d) => d.id === staffId), 'full_name') || '…' : w.common.clinicWide);

  const describe = (r) => {
    const a = clinicParts(r.starts_at);
    const b = clinicParts(r.ends_at);
    const allDay = a.time === '00:00' && b.time === '00:00';
    if (allDay) {
      const lastDay = addDays(b.day, -1);
      return lastDay === a.day ? fmt.date(r.starts_at, { weekday: 'short', day: 'numeric', month: 'short' }) : `${fmt.day(r.starts_at)} → ${fmt.date(`${lastDay}T12:00:00Z`, { weekday: 'short', day: 'numeric', month: 'short' })}`;
    }
    return a.day === b.day ? `${fmt.day(r.starts_at)} · ${fmt.time(r.starts_at)}–${fmt.time(r.ends_at)}` : `${fmt.dateTime(r.starts_at)} → ${fmt.dateTime(r.ends_at)}`;
  };

  return (
    <>
      <PageHead title={w.shell.nav.timeOff} sub={t.sub}>
        <WriteButton kind="primary" onClick={() => setEditing({})}>
          + {t.add}
        </WriteButton>
      </PageHead>
      {clash != null && clash > 0 && <Notice tone="warn">{say(t.clash, { n: fmt.number(clash) })}</Notice>}

      <div className={s.grid2wide}>
        <Card
          title={t.list}
          flush
          action={<Segmented value={when} onChange={setWhen} options={[['upcoming', t.upcoming], ['past', t.past]]} label={t.list} />}
        >
          <Loaded state={state} rows={4} empty={rows.length === 0} emptyText={when === 'upcoming' ? t.noneUpcoming : t.nonePast}>
            <Table
              rows={rows}
              onRow={can.write ? (r) => setEditing(r) : undefined}
              columns={[
                { key: 'who', label: t.who, render: (r) => (r.staff_id ? name(r.staff_id) : <Badge tone="amber">{w.common.clinicWide}</Badge>) },
                { key: 'when', label: t.when, render: describe },
                { key: 'reason', label: t.reason, hide: 'sm', render: (r) => r.reason ?? '—' },
                {
                  key: 'x',
                  label: '',
                  align: 'end',
                  render: (r) =>
                    can.write && (
                      <Button size="sm" kind="ghost" aria-label={w.common.delete} onClick={(e) => (e.stopPropagation(), setRemoving(r))}>
                        <Icon name="trash" size={16} />
                      </Button>
                    ),
                },
              ]}
            />
          </Loaded>
        </Card>
        <Card title={fmt.date(`${month}-15T12:00:00Z`, { month: 'long', year: 'numeric' })} action={<MonthNav month={month} setMonth={setMonth} />}>
          <MonthGrid month={month} rows={state.data ?? []} name={name} />
        </Card>
      </div>

      <Drawer open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? t.edit : t.add}>
        {editing && (
          <TimeOffForm
            row={editing}
            doctors={doctors}
            onCancel={() => setEditing(null)}
            onSaved={(clashing) => {
              setEditing(null);
              setClash(clashing ?? null);
              state.reload();
            }}
          />
        )}
      </Drawer>
      <Confirm
        open={Boolean(removing)}
        danger
        title={t.remove}
        text={removing ? `${name(removing.staff_id)} · ${describe(removing)}` : ''}
        confirmLabel={w.common.delete}
        busy={busy}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          await run(() => api(`/staff/time-off/${removing.id}`, { method: 'DELETE' }), { success: t.removed });
          setRemoving(null);
          state.reload();
        }}
      />
    </>
  );
}

function MonthNav({ month, setMonth }) {
  const { w } = useDash();
  const shift = (n) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  return (
    <span className={s.rowWrap}>
      <Button size="sm" kind="ghost" onClick={() => shift(-1)} aria-label={w.common.prev}>
        <span className="flip-rtl">‹</span>
      </Button>
      <Button size="sm" kind="ghost" onClick={() => shift(1)} aria-label={w.common.next}>
        <span className="flip-rtl">›</span>
      </Button>
    </span>
  );
}

/** A month: each day shows who is off (a chip per doctor, amber for the whole clinic). */
function MonthGrid({ month, rows, name }) {
  const { fmt } = useDash();
  const first = `${month}-01`;
  const startPad = (new Date(`${first}T12:00:00Z`).getUTCDay() + 1) % 7; // weeks start on Saturday
  const days = [];
  for (let d = first; d.startsWith(month); d = addDays(d, 1)) days.push(d);
  const off = (day) =>
    rows.filter((r) => {
      const from = clinicParts(r.starts_at).day;
      const lastInstant = new Date(new Date(r.ends_at).getTime() - 1).toISOString();
      return day >= from && day <= clinicParts(lastInstant).day;
    });
  const today = clinicDay();
  return (
    <div className={s.month}>
      {Array.from({ length: 7 }, (_, i) => (
        <span key={i} className={s.monthHead}>
          {fmt.date(`2026-10-${String(3 + i).padStart(2, '0')}T12:00:00Z`, { weekday: 'narrow' })}
        </span>
      ))}
      {Array.from({ length: startPad }, (_, i) => (
        <span key={`pad${i}`} />
      ))}
      {days.map((d) => (
        <div key={d} className={s.monthDay} data-today={d === today || undefined}>
          <small>{fmt.number(Number(d.slice(8)))}</small>
          {off(d).map((r) => (
            <span key={r.id} className={s.monthChip} data-clinic={!r.staff_id || undefined} title={`${name(r.staff_id)}${r.reason ? ` · ${r.reason}` : ''}`}>
              {name(r.staff_id)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function TimeOffForm({ row, doctors, onCancel, onSaved }) {
  const { w, pick, api, toast } = useDash();
  const t = w.timeOff;
  const editing = Boolean(row.id);
  const a = row.id ? clinicParts(row.starts_at) : { day: clinicDay(), time: '09:00' };
  const b = row.id ? clinicParts(row.ends_at) : { day: clinicDay(), time: '17:00' };
  const wasAllDay = !row.id || (a.time === '00:00' && b.time === '00:00');
  const [form, setForm] = useState({
    staff_id: row.staff_id ?? '',
    allDay: wasAllDay,
    fromDay: a.day,
    toDay: wasAllDay && row.id ? addDays(b.day, -1) : b.day,
    fromTime: wasAllDay ? '09:00' : a.time,
    toTime: wasAllDay ? '17:00' : b.time,
    reason: row.reason ?? '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    const starts_at = form.allDay ? clinicDateTime(form.fromDay, '00:00') : clinicDateTime(form.fromDay, form.fromTime);
    const ends_at = form.allDay ? clinicDateTime(addDays(form.toDay, 1), '00:00') : clinicDateTime(form.fromDay, form.toTime);
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api(`/staff/time-off/${row.id}`, { method: 'PATCH', body: { starts_at, ends_at, reason: form.reason.trim() || null } });
        toast(w.common.saved);
        onSaved(null);
      } else {
        const result = await api('/staff/time-off', {
          method: 'POST',
          body: { staff_id: form.staff_id || null, starts_at, ends_at, ...(form.reason.trim() && { reason: form.reason.trim() }) },
        });
        toast(t.added);
        onSaved(result.clashing_bookings);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.stack}>
      <FormGrid>
        <SelectField
          label={t.who}
          wide
          disabled={editing}
          value={form.staff_id}
          onChange={set('staff_id')}
          options={[['', `${w.common.clinicWide} — ${t.clinicClosed}`], ...doctors.map((d) => [d.id, pick(d, 'full_name')])]}
        />
      </FormGrid>
      <Toggle checked={form.allDay} onChange={set('allDay')} label={t.allDay} />
      <FormGrid>
        <TextField label={form.allDay ? t.firstDay : t.day} type="date" value={form.fromDay} onChange={(v) => setForm((f) => ({ ...f, fromDay: v, toDay: f.toDay < v ? v : f.toDay }))} />
        {form.allDay ? (
          <TextField label={t.lastDay} type="date" min={form.fromDay} value={form.toDay} onChange={set('toDay')} />
        ) : (
          <>
            <TextField label={t.fromTime} type="time" step={300} value={form.fromTime} onChange={set('fromTime')} />
            <TextField label={t.toTime} type="time" step={300} value={form.toTime} onChange={set('toTime')} />
          </>
        )}
        <TextField label={t.reason} hint={t.reasonHint} wide value={form.reason} onChange={set('reason')} maxLength={200} />
      </FormGrid>
      {editing && <p className={s.muted}>{t.whoLocked}</p>}
      {error && <Notice tone="error">{error}</Notice>}
      <div className={s.rowEnd}>
        <Button onClick={onCancel}>{w.common.cancel}</Button>
        <Button kind="primary" busy={busy} disabled={!form.allDay && form.toTime <= form.fromTime} onClick={save}>
          {w.common.save}
        </Button>
      </div>
    </div>
  );
}
