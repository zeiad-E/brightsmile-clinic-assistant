'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { localePath } from '@/i18n/config';
import { clinicDay, useAction, useApi, useDash, useNow } from '../DashProvider';
import { Avatar, Badge, Button, Card, Confirm, Empty, Facts, FormGrid, Loaded, Notice, PageHead, Segmented, SelectField, StatusBadge, Table, TextField, WriteButton } from '../kit';
import { AppointmentDrawer, BookingDrawer } from './shared';
import s from './screens.module.css';

const FIELDS = ['full_name', 'date_of_birth', 'phone', 'email', 'preferred_language', 'notes'];

function ageOn(dob, today) {
  if (!dob) return null;
  const [y, m, d] = dob.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}

/**
 * One patient: details (staff edit them, incl. private clinic notes), visits, chats, and sign-in
 * help (send a new personal code, unlock after too many wrong phone sign-ins). "Book a visit"
 * opens the booking panel with this patient filled in.
 */
export default function PatientProfile() {
  const { id } = useParams();
  const { w, fmt, say, locale, api, can } = useDash();
  const t = w.profilePage;
  const state = useApi(`/staff/patients/${id}`);
  const p = state.data;
  const [tab, setTab] = useState('details');
  const [open, setOpen] = useState(null);
  const [booking, setBooking] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'code' | 'unlock'
  const [run, busy] = useAction();
  const now = useNow();

  if (!p) {
    return (
      <>
        <PageHead title={w.shell.nav.patients} />
        <Loaded state={state} rows={5} />
      </>
    );
  }

  const locked = p.login?.locked_until && now && new Date(p.login.locked_until).getTime() > now;
  const upcoming = p.appointments.filter((a) => a.status === 'booked' && now && new Date(a.starts_at).getTime() > now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = p.appointments.filter((a) => !upcoming.includes(a)).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const age = ageOn(p.date_of_birth, clinicDay());

  return (
    <>
      <p className={s.crumb}>
        <Link href={localePath(locale, '/dashboard/patients')}>← {w.shell.nav.patients}</Link>
      </p>
      <div className={s.profileHead}>
        <Avatar name={p.full_name} size={64} />
        <div className={s.grow}>
          <h1>{p.full_name}</h1>
          <p className={s.muted}>
            {[age != null && say(t.age, { n: fmt.number(age) }), p.phone && <span dir="ltr" key="p">{p.phone}</span>, p.email].filter(Boolean).reduce((acc, x, i) => (i ? [...acc, ' · ', x] : [x]), [])}
          </p>
          <div className={s.rowWrap}>
            {p.has_login ? <Badge tone="mint">{t.canSignIn}</Badge> : <Badge>{t.noLogin}</Badge>}
            {p.login?.has_code && <Badge tone="blue">{t.hasCode}</Badge>}
            {locked && <Badge tone="red">{say(t.lockedUntil, { time: fmt.time(p.login.locked_until) })}</Badge>}
            <Badge>{p.preferred_language === 'ar' ? w.common.ar : w.common.en}</Badge>
          </div>
        </div>
        <div className={s.actionsCol}>
          <WriteButton kind="primary" onClick={() => setBooking(true)}>
            + {t.book}
          </WriteButton>
          {p.email && <WriteButton onClick={() => setConfirm('code')}>{t.sendCode}</WriteButton>}
          {locked && <WriteButton onClick={() => setConfirm('unlock')}>{t.unlock}</WriteButton>}
        </div>
      </div>

      <Segmented
        value={tab}
        onChange={setTab}
        label={t.tabs.label}
        options={[
          ['details', t.tabs.details],
          ['visits', t.tabs.visits, p.appointments.length],
          ['chats', t.tabs.chats],
        ]}
      />

      <div className={s.tabBody}>
        {tab === 'details' && (can.write ? <DetailsForm patient={p} onSaved={state.setData} /> : <ReadOnlyDetails patient={p} />)}
        {tab === 'visits' && (
          <div className={s.stack}>
            <Card title={say(t.upcoming, { n: fmt.number(upcoming.length) })} flush>
              {upcoming.length ? <VisitTable rows={upcoming} onOpen={setOpen} /> : <Empty title={t.noUpcoming} />}
            </Card>
            <Card title={say(t.past, { n: fmt.number(past.length) })} flush>
              {past.length ? <VisitTable rows={past} onOpen={setOpen} /> : <Empty title={t.noPast} />}
            </Card>
          </div>
        )}
        {tab === 'chats' && <PatientChats patientId={p.id} />}
      </div>

      <AppointmentDrawer appointment={open} onClose={() => setOpen(null)} onChanged={() => (setOpen(null), state.reload())} />
      <BookingDrawer open={booking} onClose={() => setBooking(false)} onBooked={state.reload} patient={p} />
      <Confirm
        open={confirm === 'code'}
        title={t.sendCode}
        text={say(t.sendCodeText, { email: p.email ?? '' })}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await run(() => api(`/staff/patients/${p.id}/send-code`, { method: 'POST' }), { success: t.codeSent });
          setConfirm(null);
          state.reload();
        }}
      />
      <Confirm
        open={confirm === 'unlock'}
        title={t.unlock}
        text={t.unlockText}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await run(() => api(`/staff/patients/${p.id}/unlock`, { method: 'POST' }), { success: t.unlocked });
          setConfirm(null);
          state.reload();
        }}
      />
    </>
  );
}

function DetailsForm({ patient, onSaved }) {
  const { w, api } = useDash();
  const t = w.profilePage;
  const initial = Object.fromEntries(FIELDS.map((f) => [f, patient[f] ?? '']));
  const [form, setForm] = useState(initial);
  const [run, busy] = useAction();
  const set = (name) => (value) => setForm((f) => ({ ...f, [name]: value }));
  // only what changed is sent; an emptied email/phone/notes becomes null
  const changes = Object.fromEntries(
    FIELDS.filter((f) => form[f] !== initial[f]).map((f) => [f, form[f] === '' && ['email', 'phone', 'notes'].includes(f) ? null : form[f]]),
  );
  const identityChanged = ['full_name', 'date_of_birth', 'phone'].some((f) => f in changes);

  return (
    <Card>
      <div className={s.stack}>
        <FormGrid>
          <TextField label={w.patient.fullName} value={form.full_name} onChange={set('full_name')} />
          <TextField label={w.patient.dob} type="date" value={form.date_of_birth} onChange={set('date_of_birth')} />
          <TextField label={w.patient.phone} hint={w.patient.phoneHint} dir="ltr" value={form.phone} onChange={set('phone')} />
          <TextField label={w.patient.email} type="email" dir="ltr" value={form.email} onChange={set('email')} />
          <SelectField label={w.patient.language} value={form.preferred_language} onChange={set('preferred_language')} options={[['en', w.common.en], ['ar', w.common.ar]]} />
          <TextField label={w.patient.notes} hint={w.patient.notesHint} value={form.notes} onChange={set('notes')} multiline wide maxLength={2000} />
        </FormGrid>
        {identityChanged && <Notice tone="warn">{t.identityWarning}</Notice>}
        <div className={s.rowEnd}>
          <Button disabled={!Object.keys(changes).length} onClick={() => setForm(initial)}>
            {t.reset}
          </Button>
          <Button
            kind="primary"
            busy={busy}
            disabled={!Object.keys(changes).length}
            onClick={async () => {
              const saved = await run(() => api(`/staff/patients/${patient.id}`, { method: 'PATCH', body: changes }));
              if (saved) onSaved((old) => ({ ...old, ...saved }));
            }}
          >
            {w.common.save}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ReadOnlyDetails({ patient: p }) {
  const { w, fmt } = useDash();
  return (
    <Card>
      <Facts
        items={[
          [w.patient.fullName, p.full_name],
          [w.patient.dob, p.date_of_birth ? fmt.date(`${p.date_of_birth}T12:00:00Z`) : null],
          [w.patient.phone, p.phone],
          [w.patient.email, p.email],
          [w.patient.language, p.preferred_language === 'ar' ? w.common.ar : w.common.en],
          [w.patient.notes, p.notes],
          [w.patients.added, fmt.date(p.created_at)],
        ]}
      />
    </Card>
  );
}

function VisitTable({ rows, onOpen }) {
  const { w, fmt, pick } = useDash();
  return (
    <Table
      rows={rows}
      onRow={onOpen}
      columns={[
        { key: 'when', label: w.appointments.when, render: (a) => `${fmt.date(a.starts_at)} · ${fmt.time(a.starts_at)}` },
        { key: 'service', label: w.appointments.treatment, render: (a) => pick(a.service, 'name') },
        { key: 'doctor', label: w.appointments.doctor, hide: 'sm', render: (a) => pick(a.doctor, 'full_name') },
        { key: 'status', label: w.appointments.status, render: (a) => <StatusBadge status={a.status} /> },
      ]}
    />
  );
}

function PatientChats({ patientId }) {
  const { w, fmt, locale } = useDash();
  const router = useRouter();
  const state = useApi(`/staff/conversations?patient_id=${patientId}&limit=50`);
  const rows = state.data?.data ?? [];
  return (
    <Card flush>
      <Loaded state={state} empty={rows.length === 0} emptyText={w.profilePage.noChats}>
        <Table
          rows={rows}
          onRow={(c) => router.push(`${localePath(locale, '/dashboard/conversations')}?c=${c.id}`)}
          columns={[
            { key: 'title', label: w.conversations.topic, render: (c) => c.title ?? '—' },
            { key: 'last', label: w.conversations.last, render: (c) => fmt.dateTime(c.last_message_at) },
            { key: 'status', label: w.appointments.status, render: (c) => <StatusBadge status={c.status} /> },
            { key: 'rev', label: w.conversations.review, hide: 'sm', render: (c) => (c.reviewed_at ? <Badge tone="mint">{w.chat.reviewed}</Badge> : '—') },
          ]}
        />
      </Loaded>
    </Card>
  );
}
