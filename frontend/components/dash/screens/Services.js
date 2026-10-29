'use client';

import { useState } from 'react';
import { useAction, useApi, useDash } from '../DashProvider';
import { Badge, Button, Card, Confirm, Drawer, FormGrid, Icon, Loaded, Notice, PageHead, Table, TextField, Toggle, WriteButton } from '../kit';
import s from './screens.module.css';

const TEXT = ['slug', 'name_en', 'name_ar', 'description_en', 'description_ar', 'details_en', 'details_ar'];
const NUMBERS = ['duration_minutes', 'price_egp', 'sort_order'];

/**
 * O4 Services & prices: every treatment in English and Arabic side by side, with its price, length,
 * "what to expect" steps (one per line), order on the website, and a show/hide switch.
 */
export default function Services() {
  const { w, fmt, pick, say, api, can } = useDash();
  const t = w.services;
  const state = useApi('/admin/services');
  const [open, setOpen] = useState(null);
  const [run] = useAction();
  const rows = [...(state.data?.data ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.name_en.localeCompare(b.name_en));

  // Swap places with the neighbour (both get a new sort_order).
  const move = async (index, by) => {
    const a = rows[index];
    const b = rows[index + by];
    if (!b) return;
    const orderA = a.sort_order === b.sort_order ? index : a.sort_order;
    const orderB = a.sort_order === b.sort_order ? index + by : b.sort_order;
    await run(
      () =>
        Promise.all([
          api(`/admin/services/${a.id}`, { method: 'PATCH', body: { sort_order: orderB } }),
          api(`/admin/services/${b.id}`, { method: 'PATCH', body: { sort_order: orderA } }),
        ]),
      { success: t.reordered },
    );
    state.reload();
  };

  return (
    <>
      <PageHead title={w.shell.nav.services} sub={t.sub}>
        <WriteButton kind="primary" onClick={() => setOpen({})}>
          + {t.add}
        </WriteButton>
      </PageHead>
      <Card flush>
        <Loaded state={state} rows={6} empty={rows.length === 0}>
          <Table
            rows={rows}
            onRow={setOpen}
            columns={[
              {
                key: 'order',
                label: '',
                width: 76,
                render: (x) => {
                  const i = rows.indexOf(x);
                  return (
                    can.owner && (
                      <span className={s.rowWrap} onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" kind="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t.up}>
                          <Icon name="up" size={14} />
                        </Button>
                        <Button size="sm" kind="ghost" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={t.down}>
                          <Icon name="down" size={14} />
                        </Button>
                      </span>
                    )
                  );
                },
              },
              { key: 'name', label: t.name, render: (x) => <strong>{pick(x, 'name')}</strong> },
              { key: 'length', label: t.length, render: (x) => say(w.common.minutes, { n: fmt.number(x.duration_minutes) }) },
              { key: 'price', label: t.price, align: 'end', render: (x) => fmt.money(x.price_egp) },
              { key: 'steps', label: t.steps, hide: 'sm', render: (x) => fmt.number((pick(x, 'details') || '').split('\n').filter(Boolean).length) },
              {
                key: 'shown',
                label: t.shown,
                render: (x) => (
                  <span onClick={(e) => e.stopPropagation()}>
                    <Toggle
                      checked={x.is_active}
                      disabled={!can.owner}
                      label={x.is_active ? <Badge tone="mint">{t.visible}</Badge> : <Badge>{t.hidden}</Badge>}
                      onChange={async (on) => {
                        await run(() => api(`/admin/services/${x.id}`, { method: 'PATCH', body: { is_active: on } }));
                        state.reload();
                      }}
                    />
                  </span>
                ),
              },
            ]}
          />
        </Loaded>
      </Card>
      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title={open?.id ? pick(open, 'name') : t.add} wide>
        {open && (
          <ServiceEditor
            key={open.id ?? 'new'}
            service={open}
            nextOrder={rows.length ? Math.max(...rows.map((r) => r.sort_order)) + 1 : 0}
            onSaved={() => {
              state.reload();
              setOpen(null);
            }}
          />
        )}
      </Drawer>
    </>
  );
}

function ServiceEditor({ service, nextOrder, onSaved }) {
  const { w, api, can } = useDash();
  const t = w.services;
  const isNew = !service.id;
  const initial = {
    ...Object.fromEntries(TEXT.map((k) => [k, service[k] ?? ''])),
    duration_minutes: String(service.duration_minutes ?? 30),
    price_egp: String(service.price_egp ?? ''),
    sort_order: String(service.sort_order ?? nextOrder),
    is_active: service.is_active ?? true,
  };
  const [form, setForm] = useState(initial);
  const [hide, setHide] = useState(false);
  const [error, setError] = useState(null);
  const [run, busy] = useAction();
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const clean = (k, v) => (NUMBERS.includes(k) ? Number(v) : typeof v === 'string' ? (v.trim() === '' && !['slug', 'name_en', 'name_ar'].includes(k) ? null : v.trim()) : v);
  const changes = Object.fromEntries(
    Object.keys(form)
      .filter((k) => form[k] !== initial[k])
      .map((k) => [k, clean(k, form[k])]),
  );
  const body = isNew ? Object.fromEntries(Object.entries(form).map(([k, v]) => [k, clean(k, v)]).filter(([, v]) => v !== null)) : changes;
  const valid = form.name_en.trim() && form.name_ar.trim() && form.slug.trim() && Number(form.duration_minutes) >= 5 && form.price_egp !== '';

  return (
    <div className={s.stack}>
      <div className={s.bilingual}>
        <div>
          <p className={s.langTag}>English</p>
          <TextField label={t.name} value={form.name_en} onChange={set('name_en')} />
          <TextField label={t.description} value={form.description_en} onChange={set('description_en')} multiline maxLength={2000} />
          <TextField label={t.details} hint={t.detailsHint} value={form.details_en} onChange={set('details_en')} multiline maxLength={3000} />
        </div>
        <div dir="rtl" lang="ar">
          <p className={s.langTag}>العربية</p>
          <TextField label={t.name} value={form.name_ar} onChange={set('name_ar')} />
          <TextField label={t.description} value={form.description_ar} onChange={set('description_ar')} multiline maxLength={2000} />
          <TextField label={t.details} hint={t.detailsHint} value={form.details_ar} onChange={set('details_ar')} multiline maxLength={3000} />
        </div>
      </div>
      <FormGrid>
        <TextField label={t.slug} dir="ltr" hint={t.slugHint} value={form.slug} onChange={(v) => set('slug')(v.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} />
        <TextField label={t.length} type="number" min={5} max={480} step={5} value={form.duration_minutes} onChange={set('duration_minutes')} hint={t.lengthHint} />
        <TextField label={t.price} type="number" min={0} step={10} value={form.price_egp} onChange={set('price_egp')} />
        <TextField label={t.order} type="number" min={0} value={form.sort_order} onChange={set('sort_order')} />
      </FormGrid>
      <Toggle checked={form.is_active} onChange={set('is_active')} label={t.showOnSite} disabled={!can.owner} />
      {error && <Notice tone="error">{error}</Notice>}
      {can.owner && (
        <div className={s.rowEnd}>
          {!isNew && service.is_active && (
            <Button kind="danger" onClick={() => setHide(true)}>
              {t.hide}
            </Button>
          )}
          <Button
            kind="primary"
            busy={busy}
            disabled={!valid || (!isNew && !Object.keys(changes).length)}
            onClick={async () => {
              const saved = await run(() => api(isNew ? '/admin/services' : `/admin/services/${service.id}`, { method: isNew ? 'POST' : 'PATCH', body }), {
                onError: (err) => setError(err.details?.fields ? Object.values(err.details.fields).flat().join(' ') : err.message),
              });
              if (saved) onSaved();
            }}
          >
            {isNew ? t.create : w.common.save}
          </Button>
        </div>
      )}
      <Confirm
        open={hide}
        danger
        title={t.hide}
        text={t.hideText}
        busy={busy}
        onClose={() => setHide(false)}
        onConfirm={async () => {
          await run(() => api(`/admin/services/${service.id}`, { method: 'DELETE' }));
          setHide(false);
          onSaved();
        }}
      />
    </div>
  );
}
