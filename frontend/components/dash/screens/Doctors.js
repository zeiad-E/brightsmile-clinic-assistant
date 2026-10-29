'use client';

import { useState } from 'react';
import { useAction, useApi, useDash } from '../DashProvider';
import { Avatar, Badge, Button, Card, Confirm, Drawer, FormGrid, Loaded, Notice, PageHead, SelectField, TextField, Toggle, WriteButton } from '../kit';
import s from './screens.module.css';

const DAYS = [6, 0, 1, 2, 3, 4, 5]; // Saturday first
const FIRST_SLOT = 7 * 2; // 07:00 in half-hours
const LAST_SLOT = 23 * 2; // 23:00
const SLOTS = Array.from({ length: LAST_SLOT - FIRST_SLOT }, (_, i) => FIRST_SLOT + i);
const slotTime = (slot) => `${String(Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`;
const timeSlot = (hhmm) => Number(hhmm.slice(0, 2)) * 2 + (Number(hhmm.slice(3, 5)) >= 30 ? 1 : 0);

/** Working hours → a set of painted half-hours ("weekday-slot"). */
function toCells(hours) {
  const cells = new Set();
  for (const h of hours) for (let slot = timeSlot(h.start_time); slot < timeSlot(h.end_time); slot += 1) cells.add(`${h.weekday}-${slot}`);
  return cells;
}

/** Painted half-hours → working hours (back-to-back half-hours join into one shift). */
function toHours(cells) {
  const hours = [];
  for (const weekday of DAYS) {
    let start = null;
    for (let slot = FIRST_SLOT; slot <= LAST_SLOT; slot += 1) {
      const on = slot < LAST_SLOT && cells.has(`${weekday}-${slot}`);
      if (on && start == null) start = slot;
      if (!on && start != null) {
        hours.push({ weekday, start_time: slotTime(start), end_time: slotTime(slot) });
        start = null;
      }
    }
  }
  return hours;
}

/**
 * O3 Doctors & hours: each doctor's public profile (both languages), which treatments they do, and
 * their weekly hours — paint the grid with the mouse (or finger): drag over half-hours to switch
 * them on or off. The booking system offers only painted times.
 */
export default function Doctors() {
  const { w, pick, fmt, say } = useDash();
  const t = w.doctors;
  const state = useApi('/admin/doctors');
  const services = useApi('/admin/services');
  const [open, setOpen] = useState(null);
  const rows = state.data?.data ?? [];

  const weekly = (d) => d.working_hours.reduce((sum, h) => sum + (timeSlot(h.end_time) - timeSlot(h.start_time)) / 2, 0);

  return (
    <>
      <PageHead title={w.shell.nav.doctors} sub={t.sub}>
        <WriteButton kind="primary" onClick={() => setOpen({})}>
          + {t.add}
        </WriteButton>
      </PageHead>
      <Loaded state={state} rows={3} empty={rows.length === 0}>
        <div className={s.cards}>
          {rows.map((d) => (
            <button key={d.id} type="button" className={s.doctorCard} onClick={() => setOpen(d)} data-inactive={!d.is_active || undefined}>
              <Avatar name={d.full_name_en} photo={d.photo_url} size={52} />
              <span className={s.grow}>
                <strong>{pick(d, 'full_name')}</strong>
                <small>{t.titles[d.title]}</small>
                <span className={s.rowWrap}>
                  {!d.is_active && <Badge tone="gray">{t.hidden}</Badge>}
                  <Badge tone="blue">{say(t.treatmentsN, { n: fmt.number(d.service_ids.length) })}</Badge>
                  <Badge tone="mint">{say(t.hoursN, { n: fmt.number(weekly(d)) })}</Badge>
                </span>
              </span>
            </button>
          ))}
        </div>
      </Loaded>
      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title={open?.id ? pick(open, 'full_name') : t.add} wide>
        {open && (
          <DoctorEditor
            key={open.id ?? 'new'}
            doctor={open}
            services={services.data?.data ?? []}
            onSaved={(d) => {
              state.reload();
              setOpen(d);
            }}
            onClose={() => setOpen(null)}
          />
        )}
      </Drawer>
    </>
  );
}

function DoctorEditor({ doctor, services, onSaved, onClose }) {
  const { w, pick, api, can } = useDash();
  const t = w.doctors;
  const isNew = !doctor.id;
  const initial = {
    full_name_en: doctor.full_name_en ?? '',
    full_name_ar: doctor.full_name_ar ?? '',
    title: doctor.title ?? 'dentist',
    bio_en: doctor.bio_en ?? '',
    bio_ar: doctor.bio_ar ?? '',
    photo_url: doctor.photo_url ?? '',
    is_active: doctor.is_active ?? true,
  };
  const [form, setForm] = useState(initial);
  const [picked, setPicked] = useState(new Set(doctor.service_ids ?? []));
  const [cells, setCells] = useState(() => toCells(doctor.working_hours ?? []));
  const [paint, setPaint] = useState(null); // true = switching on, false = off, null = not dragging
  const [hide, setHide] = useState(false);
  const [run, busy] = useAction();
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const changes = Object.fromEntries(
    Object.keys(form)
      .filter((k) => form[k] !== initial[k])
      .map((k) => [k, typeof form[k] === 'string' && form[k].trim() === '' && !k.startsWith('full_name') ? null : form[k]]),
  );
  const hoursChanged = JSON.stringify(toHours(cells)) !== JSON.stringify(toHours(toCells(doctor.working_hours ?? [])));
  const servicesChanged = [...picked].sort().join() !== [...(doctor.service_ids ?? [])].sort().join();

  const cellAt = (key, on) =>
    setCells((c) => {
      const next = new Set(c);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  return (
    <div className={s.stack} onPointerUp={() => setPaint(null)} onPointerLeave={() => setPaint(null)}>
      <section className={s.formSection}>
        <h3>{t.profile}</h3>
        <FormGrid>
          <TextField label={t.nameEn} value={form.full_name_en} onChange={set('full_name_en')} />
          <TextField label={t.nameAr} dir="rtl" value={form.full_name_ar} onChange={set('full_name_ar')} />
          <SelectField label={t.title} value={form.title} onChange={set('title')} options={Object.entries(t.titles)} />
          <TextField label={t.photo} dir="ltr" hint={t.photoHint} value={form.photo_url} onChange={set('photo_url')} />
          <TextField label={t.bioEn} value={form.bio_en} onChange={set('bio_en')} multiline maxLength={2000} />
          <TextField label={t.bioAr} dir="rtl" value={form.bio_ar} onChange={set('bio_ar')} multiline maxLength={2000} />
        </FormGrid>
        <Toggle checked={form.is_active} onChange={set('is_active')} label={t.visible} disabled={!can.owner} />
        {can.owner && (
          <div className={s.rowEnd}>
            {!isNew && doctor.is_active && (
              <Button kind="danger" onClick={() => setHide(true)}>
                {t.hide}
              </Button>
            )}
            <Button
              kind="primary"
              busy={busy}
              disabled={isNew ? !form.full_name_en.trim() || !form.full_name_ar.trim() : !Object.keys(changes).length}
              onClick={async () => {
                const body = isNew ? Object.fromEntries(Object.entries(form).filter(([, v]) => v !== '')) : changes;
                const saved = await run(() => api(isNew ? '/admin/doctors' : `/admin/doctors/${doctor.id}`, { method: isNew ? 'POST' : 'PATCH', body }));
                if (saved) onSaved(saved);
              }}
            >
              {isNew ? t.create : w.common.save}
            </Button>
          </div>
        )}
      </section>

      {isNew ? (
        <Notice>{t.saveFirst}</Notice>
      ) : (
        <>
          <section className={s.formSection}>
            <h3>{t.treatments}</h3>
            <div className={s.checkGrid}>
              {services.map((x) => (
                <label key={x.id} className={s.inlineCheck}>
                  <input
                    type="checkbox"
                    disabled={!can.owner}
                    checked={picked.has(x.id)}
                    onChange={(e) =>
                      setPicked((p) => {
                        const next = new Set(p);
                        if (e.target.checked) next.add(x.id);
                        else next.delete(x.id);
                        return next;
                      })
                    }
                  />
                  {pick(x, 'name')}
                  {!x.is_active && <Badge>{t.hidden}</Badge>}
                </label>
              ))}
            </div>
            {can.owner && (
              <div className={s.rowEnd}>
                <Button
                  kind="primary"
                  busy={busy}
                  disabled={!servicesChanged}
                  onClick={async () => {
                    const saved = await run(() => api(`/admin/doctors/${doctor.id}/services`, { method: 'PUT', body: { service_ids: [...picked] } }));
                    if (saved) onSaved({ ...doctor, ...saved, service_ids: [...picked] });
                  }}
                >
                  {t.saveTreatments}
                </Button>
              </div>
            )}
          </section>

          <section className={s.formSection}>
            <h3>{t.hours}</h3>
            <p className={s.muted}>{t.hoursHint}</p>
            <HoursGrid cells={cells} paint={paint} setPaint={setPaint} cellAt={cellAt} disabled={!can.owner} />
            <HoursSummary hours={toHours(cells)} />
            {can.owner && (
              <div className={s.rowEnd}>
                <Button disabled={!hoursChanged} onClick={() => setCells(toCells(doctor.working_hours ?? []))}>
                  {w.common.reset}
                </Button>
                <Button
                  kind="primary"
                  busy={busy}
                  disabled={!hoursChanged || toHours(cells).length > 21}
                  onClick={async () => {
                    const hours = toHours(cells);
                    const saved = await run(() => api(`/admin/doctors/${doctor.id}/working-hours`, { method: 'PUT', body: { hours } }));
                    if (saved) onSaved({ ...doctor, working_hours: hours });
                  }}
                >
                  {t.saveHours}
                </Button>
              </div>
            )}
          </section>
        </>
      )}

      <Confirm
        open={hide}
        danger
        title={t.hide}
        text={t.hideText}
        busy={busy}
        onClose={() => setHide(false)}
        onConfirm={async () => {
          const saved = await run(() => api(`/admin/doctors/${doctor.id}`, { method: 'DELETE' }));
          setHide(false);
          if (saved !== undefined) onClose();
          onSaved(null);
        }}
      />
    </div>
  );
}

function HoursGrid({ cells, paint, setPaint, cellAt, disabled }) {
  const { fmt } = useDash();
  const dayName = (wd) => fmt.date(`2026-10-${String(4 + wd).padStart(2, '0')}T12:00:00Z`, { weekday: 'short' });
  return (
    <div className={s.hoursWrap}>
      <div className={s.hoursGrid} style={{ '--slots': SLOTS.length }} data-disabled={disabled || undefined}>
        <span />
        {SLOTS.map((slot) => (
          <span key={slot} className={s.hoursHead}>
            {slot % 2 === 0 ? slot / 2 : ''}
          </span>
        ))}
        {DAYS.map((wd) => (
          <div key={wd} className={s.hoursRow}>
            <span className={s.hoursDay}>{dayName(wd)}</span>
            {SLOTS.map((slot) => {
              const key = `${wd}-${slot}`;
              const on = cells.has(key);
              return (
                <button
                  key={slot}
                  type="button"
                  className={s.hoursCell}
                  data-on={on || undefined}
                  aria-label={`${dayName(wd)} ${slotTime(slot)}`}
                  aria-pressed={on}
                  disabled={disabled}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.releasePointerCapture?.(e.pointerId);
                    setPaint(!on);
                    cellAt(key, !on);
                  }}
                  onPointerEnter={() => paint != null && cellAt(key, paint)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), cellAt(key, !on))}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function HoursSummary({ hours }) {
  const { w, fmt } = useDash();
  const t = w.doctors;
  const dayName = (wd) => fmt.date(`2026-10-${String(4 + wd).padStart(2, '0')}T12:00:00Z`, { weekday: 'long' });
  return (
    <ul className={s.hoursSummary}>
      {DAYS.map((wd) => {
        const shifts = hours.filter((h) => h.weekday === wd);
        return (
          <li key={wd}>
            <strong>{dayName(wd)}</strong>
            <span dir="ltr">{shifts.length ? shifts.map((h) => `${h.start_time}–${h.end_time}`).join(', ') : t.off}</span>
          </li>
        );
      })}
    </ul>
  );
}
