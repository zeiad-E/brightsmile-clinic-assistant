'use client';

import { useState } from 'react';
import { useAction, useApi, useDash } from '../DashProvider';
import { Button, Card, FormGrid, Loaded, Notice, PageHead, TextField, Toggle } from '../kit';
import s from './screens.module.css';

const TEXT = ['name_en', 'name_ar', 'phone', 'email', 'address_en', 'address_ar'];
const NUMBERS = ['slot_step_minutes', 'min_lead_minutes', 'booking_horizon_days', 'cancellation_window_hours', 'chat_retention_days'];

/**
 * O7 Settings: the clinic's details (shown on the website and in emails, both languages), the
 * booking rules the system enforces, and the assistant's on/off switch and chat retention.
 */
export default function Settings() {
  const { w } = useDash();
  const state = useApi('/admin/settings');
  return (
    <>
      <PageHead title={w.shell.nav.settings} sub={w.settings.sub} />
      <Loaded state={state} rows={6}>
        {state.data && <SettingsForm key={state.data.updated_at ?? 'x'} settings={state.data} onSaved={state.setData} />}
      </Loaded>
    </>
  );
}

function SettingsForm({ settings, onSaved }) {
  const { w, fmt, say, api, can } = useDash();
  const t = w.settings;
  const initial = {
    ...Object.fromEntries(TEXT.map((k) => [k, settings[k] ?? ''])),
    ...Object.fromEntries(NUMBERS.map((k) => [k, String(settings[k] ?? '')])),
    assistant_enabled: settings.assistant_enabled,
  };
  const [form, setForm] = useState(initial);
  const [error, setError] = useState(null);
  const [run, busy] = useAction();
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const changes = Object.fromEntries(
    Object.keys(form)
      .filter((k) => form[k] !== initial[k])
      .map((k) => [k, NUMBERS.includes(k) ? Number(form[k]) : typeof form[k] === 'string' ? (form[k].trim() === '' && !k.startsWith('name') ? null : form[k].trim()) : form[k]]),
  );
  const off = !can.owner;
  const leadHours = Number(form.min_lead_minutes) / 60;

  return (
    <div className={s.stack}>
      <Card title={t.clinic}>
        <p className={s.muted}>{t.clinicHint}</p>
        <div className={s.bilingual}>
          <div>
            <p className={s.langTag}>English</p>
            <TextField label={t.name} value={form.name_en} onChange={set('name_en')} disabled={off} />
            <TextField label={t.address} value={form.address_en} onChange={set('address_en')} multiline disabled={off} maxLength={300} />
          </div>
          <div dir="rtl" lang="ar">
            <p className={s.langTag}>العربية</p>
            <TextField label={t.name} value={form.name_ar} onChange={set('name_ar')} disabled={off} />
            <TextField label={t.address} value={form.address_ar} onChange={set('address_ar')} multiline disabled={off} maxLength={300} />
          </div>
        </div>
        <FormGrid>
          <TextField label={t.phone} dir="ltr" value={form.phone} onChange={set('phone')} disabled={off} />
          <TextField label={t.email} type="email" dir="ltr" value={form.email} onChange={set('email')} disabled={off} />
        </FormGrid>
      </Card>

      <Card title={t.booking}>
        <FormGrid>
          <TextField label={t.slotStep} type="number" min={5} max={60} step={5} value={form.slot_step_minutes} onChange={set('slot_step_minutes')} hint={t.slotStepHint} disabled={off} />
          <TextField
            label={t.minLead}
            type="number"
            min={0}
            max={10080}
            step={15}
            value={form.min_lead_minutes}
            onChange={set('min_lead_minutes')}
            hint={say(t.minLeadHint, { hours: fmt.number(Math.round(leadHours * 10) / 10) })}
            disabled={off}
          />
          <TextField label={t.horizon} type="number" min={1} max={365} value={form.booking_horizon_days} onChange={set('booking_horizon_days')} hint={t.horizonHint} disabled={off} />
          <TextField label={t.window} type="number" min={0} max={168} value={form.cancellation_window_hours} onChange={set('cancellation_window_hours')} hint={t.windowHint} disabled={off} />
        </FormGrid>
      </Card>

      <Card title={t.assistant}>
        <div className={s.stack}>
          <Toggle checked={form.assistant_enabled} onChange={set('assistant_enabled')} label={t.assistantOn} disabled={off} />
          <FormGrid>
            <TextField label={t.retention} type="number" min={7} max={3650} value={form.chat_retention_days} onChange={set('chat_retention_days')} hint={t.retentionHint} disabled={off} />
          </FormGrid>
        </div>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}
      {can.owner && (
        <div className={s.saveBar} data-dirty={Object.keys(changes).length > 0 || undefined}>
          <span>{Object.keys(changes).length ? say(t.unsaved, { n: fmt.number(Object.keys(changes).length) }) : t.allSaved}</span>
          <Button disabled={!Object.keys(changes).length} onClick={() => setForm(initial)}>
            {w.common.reset}
          </Button>
          <Button
            kind="primary"
            busy={busy}
            disabled={!Object.keys(changes).length}
            onClick={async () => {
              setError(null);
              const saved = await run(() => api('/admin/settings', { method: 'PATCH', body: changes }), {
                onError: (err) => setError(err.details?.fields ? Object.values(err.details.fields).flat().join(' ') : err.message),
              });
              if (saved) onSaved(saved);
            }}
          >
            {w.common.save}
          </Button>
        </div>
      )}
    </div>
  );
}
