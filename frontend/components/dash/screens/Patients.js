'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { localePath } from '@/i18n/config';
import { useApi, useDash, useDebounced } from '../DashProvider';
import { Avatar, Badge, Button, Card, Drawer, FormGrid, Loaded, Notice, PageHead, SearchInput, SelectField, Table, TextField, WriteButton } from '../kit';
import s from './screens.module.css';

const PAGE = 25;

/** S3 Patients: search everyone by name, phone or email; add a new patient record (G5). */
export default function Patients() {
  const { w, fmt, locale } = useDash();
  const t = w.patients;
  const router = useRouter();
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);
  const term = useDebounced(q.trim(), 300);
  const state = useApi(`/staff/patients?limit=${PAGE}&offset=${offset}${term ? `&q=${encodeURIComponent(term)}` : ''}`);
  const rows = state.data?.data ?? [];
  const total = state.data?.meta.total ?? 0;

  return (
    <>
      <PageHead title={w.shell.nav.patients} sub={state.data ? fmt.number(total) + ' ' + t.countSuffix : t.sub}>
        <WriteButton kind="primary" onClick={() => setAdding(true)}>
          + {t.newPatient}
        </WriteButton>
      </PageHead>
      <div className={s.toolbar}>
        <div className={s.grow}>
          <SearchInput value={q} onChange={(v) => (setQ(v), setOffset(0))} placeholder={t.search} autoFocus />
        </div>
      </div>
      <Card flush>
        <Loaded state={state} rows={8} empty={rows.length === 0} emptyText={term ? t.noMatch : t.none}>
          <Table
            rows={rows}
            onRow={(p) => router.push(localePath(locale, `/dashboard/patients/${p.id}`))}
            columns={[
              {
                key: 'name',
                label: t.name,
                render: (p) => (
                  <span className={s.nameCell}>
                    <Avatar name={p.full_name} size={30} />
                    <strong>{p.full_name}</strong>
                  </span>
                ),
              },
              { key: 'phone', label: w.patient.phone, render: (p) => <span dir="ltr">{p.phone ?? '—'}</span> },
              { key: 'email', label: w.patient.email, hide: 'sm', render: (p) => p.email ?? '—' },
              { key: 'lang', label: w.patient.language, hide: 'sm', render: (p) => (p.preferred_language === 'ar' ? w.common.ar : w.common.en) },
              { key: 'login', label: t.online, hide: 'sm', render: (p) => (p.has_login ? <Badge tone="mint">{t.hasLogin}</Badge> : <Badge>{t.noLogin}</Badge>) },
              { key: 'added', label: t.added, hide: 'sm', render: (p) => fmt.date(p.created_at) },
            ]}
          />
          {total > PAGE && (
            <div className={s.pager}>
              <Button size="sm" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE))}>
                {w.common.prev}
              </Button>
              <span>
                {fmt.number(offset + 1)}–{fmt.number(Math.min(offset + PAGE, total))} / {fmt.number(total)}
              </span>
              <Button size="sm" disabled={offset + PAGE >= total} onClick={() => setOffset((o) => o + PAGE)}>
                {w.common.next}
              </Button>
            </div>
          )}
        </Loaded>
      </Card>
      <Drawer open={adding} onClose={() => setAdding(false)} title={t.newPatient} sub={t.newPatientSub}>
        <NewPatientForm onDone={(p) => router.push(localePath(locale, `/dashboard/patients/${p.id}`))} onCancel={() => setAdding(false)} />
      </Drawer>
    </>
  );
}

function NewPatientForm({ onDone, onCancel }) {
  const { w, api, toast } = useDash();
  const t = w.patients;
  const [form, setForm] = useState({ full_name: '', date_of_birth: '', phone: '', email: '', preferred_language: 'en', notes: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (name) => (value) => setForm((f) => ({ ...f, [name]: value }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim?.() !== ''));
      const patient = await api('/staff/patients', { method: 'POST', body });
      toast(t.created);
      onDone(patient);
    } catch (err) {
      setError(err.details?.fields ? Object.values(err.details.fields).flat().join(' ') : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.stack}>
      <FormGrid>
        <TextField label={w.patient.fullName} value={form.full_name} onChange={set('full_name')} required />
        <TextField label={w.patient.dob} type="date" value={form.date_of_birth} onChange={set('date_of_birth')} required />
        <TextField label={w.patient.phone} hint={w.patient.phoneHint} dir="ltr" value={form.phone} onChange={set('phone')} />
        <TextField label={w.patient.email} type="email" dir="ltr" value={form.email} onChange={set('email')} />
        <SelectField label={w.patient.language} value={form.preferred_language} onChange={set('preferred_language')} options={[['en', w.common.en], ['ar', w.common.ar]]} />
        <TextField label={w.patient.notes} hint={w.patient.notesHint} value={form.notes} onChange={set('notes')} multiline wide maxLength={2000} />
      </FormGrid>
      <p className={s.muted}>{t.contactRule}</p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className={s.rowEnd}>
        <Button onClick={onCancel}>{w.common.cancel}</Button>
        <WriteButton kind="primary" busy={busy} disabled={!form.full_name || !form.date_of_birth || !(form.phone || form.email)} onClick={save}>
          {t.create}
        </WriteButton>
      </div>
    </div>
  );
}
