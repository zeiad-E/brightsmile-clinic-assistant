'use client';

import { useState } from 'react';
import { useSession } from '@/components/providers/SessionProvider';
import { useAction, useApi, useDash } from '../DashProvider';
import { Avatar, Badge, Button, Card, Facts, FormGrid, Loaded, Notice, PageHead, SelectField, TextField } from '../kit';
import s from './screens.module.css';

/**
 * S7 My profile (every team member, G6): name, phone and language; doctors also their public bio and
 * photo. Email, role and title stay with the owner. Plus "change password". The demo viewer only
 * looks.
 */
export default function MyProfile() {
  const { w, can, fmt } = useDash();
  const t = w.myProfile;
  const state = useApi('/auth/profile');
  const me = state.data;

  return (
    <>
      <PageHead title={w.shell.nav.profile} sub={t.sub} />
      <Loaded state={state} rows={4}>
        {me && (
          <div className={s.stack}>
            <div className={s.profileHead}>
              <Avatar name={me.full_name ?? me.email} size={64} photo={me.doctor?.photo_url} />
              <div className={s.grow}>
                <h1>{me.full_name}</h1>
                <p className={s.muted}>{me.email}</p>
                <div className={s.rowWrap}>
                  <Badge tone={me.role === 'owner' ? 'violet' : me.role === 'viewer' ? 'gray' : 'mint'}>{w.roles[me.role]}</Badge>
                  {me.doctor && <Badge tone="blue">{w.doctors.titles[me.doctor.title]}</Badge>}
                  <small className={s.muted}>{fmt.date(me.created_at)}</small>
                </div>
              </div>
            </div>
            {can.write ? <DetailsForm me={me} onSaved={state.setData} /> : <ReadOnly me={me} />}
            {can.write && <PasswordForm />}
          </div>
        )}
      </Loaded>
    </>
  );
}

function DetailsForm({ me, onSaved }) {
  const { w, api } = useDash();
  const { refreshUser } = useSession();
  const t = w.myProfile;
  const initial = {
    full_name: me.full_name ?? '',
    phone: me.phone ?? '',
    preferred_language: me.preferred_language ?? 'en',
    ...(me.doctor && { bio_en: me.doctor.bio_en ?? '', bio_ar: me.doctor.bio_ar ?? '', photo_url: me.doctor.photo_url ?? '' }),
  };
  const [form, setForm] = useState(initial);
  const [run, busy] = useAction();
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const changes = Object.fromEntries(
    Object.keys(form)
      .filter((k) => form[k] !== initial[k])
      .map((k) => [k, form[k].trim() === '' && k !== 'full_name' ? null : form[k].trim()]),
  );

  return (
    <Card title={t.details}>
      <div className={s.stack}>
        <FormGrid>
          <TextField label={t.name} value={form.full_name} onChange={set('full_name')} />
          <TextField label={t.email} value={me.email} disabled hint={t.emailHint} onChange={() => {}} />
          <TextField label={t.phone} hint={w.patient.phoneHint} dir="ltr" value={form.phone} onChange={set('phone')} />
          <SelectField label={t.language} value={form.preferred_language} onChange={set('preferred_language')} options={[['en', w.common.en], ['ar', w.common.ar]]} />
        </FormGrid>
        {me.doctor && (
          <>
            <h3 className={s.h3}>{t.public}</h3>
            <p className={s.muted}>{t.publicHint}</p>
            <FormGrid>
              <TextField label={t.bioEn} value={form.bio_en} onChange={set('bio_en')} multiline maxLength={2000} />
              <TextField label={t.bioAr} value={form.bio_ar} onChange={set('bio_ar')} multiline maxLength={2000} dir="rtl" />
              <TextField label={t.photo} hint={t.photoHint} wide dir="ltr" value={form.photo_url} onChange={set('photo_url')} />
            </FormGrid>
          </>
        )}
        <div className={s.rowEnd}>
          <Button disabled={!Object.keys(changes).length} onClick={() => setForm(initial)}>
            {w.common.reset}
          </Button>
          <Button
            kind="primary"
            busy={busy}
            disabled={!Object.keys(changes).length || !form.full_name.trim()}
            onClick={async () => {
              const saved = await run(() => api('/auth/profile', { method: 'PATCH', body: changes }));
              if (saved) {
                onSaved(saved);
                // the name in the top bar comes from the session: refresh it
                if ('full_name' in changes || 'preferred_language' in changes) refreshUser();
              }
            }}
          >
            {w.common.save}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ReadOnly({ me }) {
  const { w } = useDash();
  const t = w.myProfile;
  return (
    <Card title={t.details}>
      <Facts
        items={[
          [t.name, me.full_name],
          [t.email, me.email],
          [t.phone, me.phone],
          [t.language, me.preferred_language === 'ar' ? w.common.ar : w.common.en],
        ]}
      />
      <p className={s.muted}>{w.common.readOnly}</p>
    </Card>
  );
}

/** Rough strength: length + variety. Only a hint; the API's rule is ≥ 10 characters. */
function strength(password) {
  let score = 0;
  if (password.length >= 10) score += 1;
  if (password.length >= 14) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(4, score);
}

function PasswordForm() {
  const { w, api, toast } = useDash();
  const t = w.myProfile;
  const [form, setForm] = useState({ current: '', next: '', again: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const score = strength(form.next);
  const mismatch = form.again && form.again !== form.next;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password', { method: 'POST', body: { current_password: form.current, new_password: form.next } });
      toast(t.passwordChanged);
      setForm({ current: '', next: '', again: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t.password}>
      <div className={s.stack}>
        <FormGrid>
          <TextField label={t.current} type="password" autoComplete="current-password" value={form.current} onChange={set('current')} />
          <TextField label={t.new} type="password" autoComplete="new-password" hint={t.newHint} value={form.next} onChange={set('next')} />
          <TextField label={t.again} type="password" autoComplete="new-password" error={mismatch ? t.mismatch : null} value={form.again} onChange={set('again')} />
        </FormGrid>
        {form.next && (
          <div className={s.meter} data-score={score} aria-label={t.strength[score]}>
            <span />
            <small>{t.strength[score]}</small>
          </div>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <div className={s.rowEnd}>
          <Button kind="primary" busy={busy} disabled={!form.current || form.next.length < 10 || form.next !== form.again} onClick={save}>
            {t.changePassword}
          </Button>
        </div>
      </div>
    </Card>
  );
}
