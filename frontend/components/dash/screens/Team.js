'use client';

import { useState } from 'react';
import { useAction, useApi, useDash } from '../DashProvider';
import { Avatar, Badge, Button, Card, Confirm, Drawer, Facts, FormGrid, Icon, Loaded, Notice, PageHead, SelectField, Table, TextField, WriteButton } from '../kit';
import s from './screens.module.css';

/**
 * O2 Team & accounts: everyone who signs in on the team side. The owner creates accounts (a
 * temporary password is emailed and shown once), edits a member's details, changes role, links a
 * doctor profile, disables / enables, and resends the invitation (G7). The owner's own account is
 * edited on "My profile" and can't be demoted here.
 */
export default function Team() {
  const { w, fmt, pick, user } = useDash();
  const t = w.team;
  const state = useApi('/admin/team');
  const doctors = useApi('/admin/doctors');
  const [open, setOpen] = useState(null); // a member, or {} for "new"
  const [secret, setSecret] = useState(null); // { email, password } shown once
  const rows = state.data?.data ?? [];
  const doctorList = doctors.data?.data ?? [];

  return (
    <>
      <PageHead title={w.shell.nav.team} sub={t.sub}>
        <WriteButton kind="primary" onClick={() => setOpen({})}>
          + {t.add}
        </WriteButton>
      </PageHead>
      {secret && <PasswordOnce secret={secret} onClose={() => setSecret(null)} />}
      <Card flush>
        <Loaded state={state} rows={4} empty={rows.length === 0}>
          <Table
            rows={rows}
            onRow={(m) => setOpen(m)}
            columns={[
              {
                key: 'name',
                label: t.name,
                render: (m) => (
                  <span className={s.nameCell}>
                    <Avatar name={m.full_name ?? m.email} size={30} />
                    <span>
                      <strong>{m.full_name}</strong>
                      {m.id === user.id && <small className={s.muted}> · {t.you}</small>}
                    </span>
                  </span>
                ),
              },
              { key: 'email', label: t.email, hide: 'sm', render: (m) => m.email },
              { key: 'role', label: t.role, render: (m) => <Badge tone={m.role === 'owner' ? 'violet' : m.role === 'viewer' ? 'gray' : 'mint'}>{w.roles[m.role]}</Badge> },
              { key: 'doctor', label: t.doctor, hide: 'sm', render: (m) => (m.staff ? pick(m.staff, 'full_name') : '—') },
              { key: 'state', label: t.state, render: (m) => (m.disabled ? <Badge tone="red">{t.disabled}</Badge> : <Badge tone="mint">{t.active}</Badge>) },
              { key: 'since', label: t.since, hide: 'sm', render: (m) => fmt.date(m.created_at) },
            ]}
          />
        </Loaded>
      </Card>

      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title={open?.id ? (open.full_name ?? open.email) : t.add} sub={open?.id ? w.roles[open.role] : t.addSub}>
        {open && !open.id && (
          <CreateForm
            doctors={doctorList}
            onCancel={() => setOpen(null)}
            onCreated={(result, email) => {
              setOpen(null);
              setSecret({ email, password: result.temporary_password });
              state.reload();
            }}
          />
        )}
        {open?.id && (
          <MemberPanel
            key={open.id}
            member={open}
            doctors={doctorList}
            onChanged={(m) => {
              state.reload();
              if (m) setOpen(m);
            }}
            onSecret={(password) => setSecret({ email: open.email, password })}
          />
        )}
      </Drawer>
    </>
  );
}

function PasswordOnce({ secret, onClose }) {
  const { w, say, toast } = useDash();
  const t = w.team;
  return (
    <Notice tone="warn">
      <span className={s.secret}>
        <span>{say(t.passwordOnce, { email: secret.email })}</span>
        <code dir="ltr">{secret.password}</code>
        <Button size="sm" onClick={() => navigator.clipboard?.writeText(secret.password).then(() => toast(w.common.copied))}>
          <Icon name="copy" size={14} /> {w.common.copy}
        </Button>
        <Button size="sm" kind="ghost" onClick={onClose}>
          {w.common.close}
        </Button>
      </span>
    </Notice>
  );
}

function CreateForm({ doctors, onCancel, onCreated }) {
  const { w, pick, api, toast } = useDash();
  const t = w.team;
  const [form, setForm] = useState({ full_name: '', email: '', role: 'staff', staff_id: '', preferred_language: 'en' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const free = doctors.filter((d) => !d.profile_id);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const { staff_id: staffId, ...rest } = form;
      const result = await api('/admin/team', { method: 'POST', body: { ...rest, ...(staffId && { staff_id: staffId }) } });
      toast(t.created);
      onCreated(result, form.email);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.stack}>
      <FormGrid>
        <TextField label={t.name} value={form.full_name} onChange={set('full_name')} />
        <TextField label={t.email} type="email" dir="ltr" hint={t.emailHint} value={form.email} onChange={set('email')} />
        <SelectField label={t.role} value={form.role} onChange={set('role')} options={[['staff', w.roles.staff], ['viewer', w.roles.viewer]]} hint={t.roleHint} />
        <SelectField label={t.language} value={form.preferred_language} onChange={set('preferred_language')} options={[['en', w.common.en], ['ar', w.common.ar]]} />
        <SelectField label={t.linkDoctor} wide hint={t.linkHint} value={form.staff_id} onChange={set('staff_id')} options={[['', t.noDoctor], ...free.map((d) => [d.id, pick(d, 'full_name')])]} />
      </FormGrid>
      <Notice>{t.inviteNote}</Notice>
      {error && <Notice tone="error">{error}</Notice>}
      <div className={s.rowEnd}>
        <Button onClick={onCancel}>{w.common.cancel}</Button>
        <Button kind="primary" busy={busy} disabled={!form.full_name.trim() || !form.email.trim()} onClick={save}>
          {t.create}
        </Button>
      </div>
    </div>
  );
}

function MemberPanel({ member: m, doctors, onChanged, onSecret }) {
  const { w, fmt, pick, api, can, user } = useDash();
  const t = w.team;
  const locked = m.role === 'owner' || m.id === user.id;
  const initial = { full_name: m.full_name ?? '', email: m.email ?? '', phone: m.phone ?? '', staff_id: m.staff?.id ?? '' };
  const [form, setForm] = useState(initial);
  const [confirm, setConfirm] = useState(null); // 'disable' | 'enable' | 'invite'
  const [run, busy] = useAction();
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const changes = Object.fromEntries(
    Object.keys(form)
      .filter((k) => form[k] !== initial[k])
      .map((k) => [k, form[k] === '' && (k === 'phone' || k === 'staff_id') ? null : form[k]]),
  );
  const linkable = doctors.filter((d) => !d.profile_id || d.profile_id === m.id);

  if (locked || !can.owner) {
    return (
      <div className={s.stack}>
        <Facts
          items={[
            [t.email, m.email],
            [t.phone, m.phone],
            [t.role, w.roles[m.role]],
            [t.doctor, m.staff ? pick(m.staff, 'full_name') : null],
            [t.since, fmt.date(m.created_at)],
          ]}
        />
        {locked && <Notice>{m.id === user.id ? t.selfNote : t.ownerNote}</Notice>}
      </div>
    );
  }

  return (
    <div className={s.stack}>
      {m.disabled && <Notice tone="error">{t.disabledNote}</Notice>}
      <FormGrid>
        <TextField label={t.name} value={form.full_name} onChange={set('full_name')} />
        <TextField label={t.email} type="email" dir="ltr" hint={t.emailChangeHint} value={form.email} onChange={set('email')} />
        <TextField label={t.phone} dir="ltr" hint={w.patient.phoneHint} value={form.phone} onChange={set('phone')} />
        <SelectField label={t.linkDoctor} value={form.staff_id} onChange={set('staff_id')} options={[['', t.noDoctor], ...linkable.map((d) => [d.id, pick(d, 'full_name')])]} />
      </FormGrid>
      <div className={s.rowEnd}>
        <Button
          kind="primary"
          busy={busy}
          disabled={!Object.keys(changes).length}
          onClick={async () => {
            const saved = await run(() => api(`/admin/team/${m.id}`, { method: 'PATCH', body: changes }));
            if (saved) onChanged(saved);
          }}
        >
          {w.common.save}
        </Button>
      </div>

      <section className={s.panelBox}>
        <h3 className={s.h3}>{t.access}</h3>
        <SelectField
          label={t.role}
          value={m.role}
          onChange={async (role) => {
            const saved = await run(() => api(`/admin/team/${m.id}/role`, { method: 'PATCH', body: { role } }), { success: t.roleChanged });
            if (saved) onChanged(saved);
          }}
          options={[['staff', w.roles.staff], ['viewer', w.roles.viewer]]}
          hint={t.roleHint}
        />
        <div className={s.rowWrap}>
          <Button onClick={() => setConfirm('invite')}>
            <Icon name="mail" size={16} /> {t.resend}
          </Button>
          {m.disabled ? (
            <Button onClick={() => setConfirm('enable')}>{t.enable}</Button>
          ) : (
            <Button kind="danger" onClick={() => setConfirm('disable')}>
              {t.disable}
            </Button>
          )}
        </div>
      </section>

      <Confirm
        open={Boolean(confirm)}
        danger={confirm === 'disable'}
        title={confirm === 'invite' ? t.resend : confirm === 'enable' ? t.enable : t.disable}
        text={confirm === 'invite' ? t.resendText : confirm === 'enable' ? t.enableText : t.disableText}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm === 'invite') {
            const result = await run(() => api(`/admin/team/${m.id}/resend-invite`, { method: 'POST' }), { success: t.resent });
            if (result) onSecret(result.temporary_password);
          } else {
            const saved = await run(() => api(`/admin/team/${m.id}/${confirm}`, { method: 'POST' }));
            if (saved) onChanged(saved);
          }
          setConfirm(null);
        }}
      />
    </div>
  );
}
