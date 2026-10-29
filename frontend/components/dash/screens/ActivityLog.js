'use client';

import { Fragment, useState } from 'react';
import { addDays, clinicDateTime, clinicDay, useApi, useDash } from '../DashProvider';
import { Badge, Button, Card, Loaded, PageHead, Segmented, SelectField, StatusBadge, Table, TextField } from '../kit';
import s from './screens.module.css';

const ENTITIES = ['appointments', 'time_off', 'services', 'staff', 'staff_services', 'working_hours', 'clinic_settings', 'patient_memories', 'intake_fields'];
const PAGE = 50;
const SKIP = new Set(['updated_at', 'created_at', 'id']);

/** Only the fields that changed, as [field, before, after]. */
function diff(before, after) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys]
    .filter((k) => !SKIP.has(k) && JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]))
    .map((k) => [k, before?.[k], after?.[k]]);
}
const show = (v) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * O8 Activity log: who changed what and when (bookings, hours, prices, settings…, with before → after),
 * and every email the system sent (with its delivery status).
 */
export default function ActivityLog() {
  const { w } = useDash();
  const [tab, setTab] = useState('changes');
  return (
    <>
      <PageHead title={w.shell.nav.activity} sub={w.activity.sub} />
      <Segmented
        value={tab}
        onChange={setTab}
        label={w.activity.sub}
        options={[
          ['changes', w.activity.changes],
          ['emails', w.activity.emails],
        ]}
      />
      <div className={s.tabBody}>{tab === 'changes' ? <Changes /> : <Emails />}</div>
    </>
  );
}

function Changes() {
  const { w, fmt } = useDash();
  const t = w.activity;
  const today = clinicDay();
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(null);
  const team = useApi('/admin/team');
  const query = new URLSearchParams({
    limit: String(PAGE),
    offset: String(offset),
    ...(entity && { entity }),
    ...(from && { from: clinicDateTime(from) }),
    ...(to && { to: clinicDateTime(addDays(to, 1)) }),
  });
  const state = useApi(`/admin/audit-log?${query}`);
  const names = new Map((team.data?.data ?? []).map((m) => [m.id, m.full_name ?? m.email]));
  const rows = state.data?.data ?? [];
  const total = state.data?.meta.total ?? 0;
  const who = (r) => (r.actor_id ? (names.get(r.actor_id) ?? t.someone) : t.via[r.via] ?? t.via.system);

  return (
    <>
      <div className={s.toolbar}>
        <div className={s.filters}>
          <SelectField label={t.what} value={entity} onChange={(v) => (setEntity(v), setOffset(0))} options={[['', w.common.all], ...ENTITIES.map((e) => [e, t.entities[e]])]} />
          <TextField label={w.common.from} type="date" value={from} max={to} onChange={(v) => (setFrom(v), setOffset(0))} />
          <TextField label={w.common.to} type="date" value={to} min={from} onChange={(v) => (setTo(v), setOffset(0))} />
        </div>
      </div>
      <Card flush>
        <Loaded state={state} rows={8} empty={rows.length === 0} emptyText={t.none}>
          <div className={s.tableWrapPlain}>
            <table className={s.logTable}>
              <thead>
                <tr>
                  <th>{t.when}</th>
                  <th>{t.who}</th>
                  <th>{t.what}</th>
                  <th className={s.hideSm}>{t.changed}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const [table, op] = r.action.split('.');
                  const changes = diff(r.before, r.after);
                  const isOpen = open === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr className={s.clickRow} onClick={() => setOpen(isOpen ? null : r.id)}>
                        <td className={s.nowrap}>{fmt.dateTime(r.created_at)}</td>
                        <td>
                          {who(r)} {r.via !== 'dashboard' && <Badge>{t.via[r.via] ?? r.via}</Badge>}
                        </td>
                        <td>
                          <Badge tone={op === 'delete' ? 'red' : op === 'insert' ? 'mint' : 'blue'}>{t.ops[op] ?? op}</Badge> {t.entities[table] ?? table}
                        </td>
                        <td className={s.hideSm}>
                          <span className={s.muted}>{op === 'update' ? changes.map(([k]) => k).join(', ') : '—'}</span>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={4} className={s.diffCell}>
                            <table className={s.diff}>
                              <tbody>
                                {(op === 'update' ? changes : Object.entries((op === 'delete' ? r.before : r.after) ?? {}).filter(([k]) => !SKIP.has(k)).map(([k, v]) => [k, op === 'delete' ? v : undefined, op === 'delete' ? undefined : v])).map(
                                  ([k, a, b]) => (
                                    <tr key={k}>
                                      <th>{k}</th>
                                      <td className={s.before}>{a === undefined ? '' : show(a)}</td>
                                      <td className={s.after}>{b === undefined ? '' : show(b)}</td>
                                    </tr>
                                  ),
                                )}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager offset={offset} total={total} setOffset={setOffset} />
        </Loaded>
      </Card>
    </>
  );
}

function Emails() {
  const { w, fmt } = useDash();
  const t = w.activity;
  const [status, setStatus] = useState('');
  const [template, setTemplate] = useState('');
  const [offset, setOffset] = useState(0);
  const query = new URLSearchParams({ limit: String(PAGE), offset: String(offset), ...(status && { status }), ...(template && { template }) });
  const state = useApi(`/admin/notifications?${query}`);
  const rows = state.data?.data ?? [];
  return (
    <>
      <div className={s.toolbar}>
        <div className={s.filters}>
          <SelectField label={t.status} value={status} onChange={(v) => (setStatus(v), setOffset(0))} options={[['', w.common.all], ['sent', w.status.sent], ['queued', w.status.queued], ['failed', w.status.failed]]} />
          <SelectField
            label={t.template}
            value={template}
            onChange={(v) => (setTemplate(v), setOffset(0))}
            options={[['', w.common.all], ...Object.entries(t.templates)]}
          />
        </div>
      </div>
      <Card flush>
        <Loaded state={state} rows={8} empty={rows.length === 0} emptyText={t.noEmails}>
          <Table
            rows={rows}
            columns={[
              { key: 'when', label: t.when, render: (n) => fmt.dateTime(n.created_at) },
              { key: 'tpl', label: t.template, render: (n) => t.templates[n.template] ?? n.template },
              { key: 'to', label: t.to, render: (n) => <span dir="ltr">{n.to_address}</span> },
              { key: 'status', label: t.status, render: (n) => <StatusBadge status={n.status} /> },
              { key: 'err', label: t.error, hide: 'sm', render: (n) => (n.error ? <span className={s.errText}>{n.error}</span> : '—') },
            ]}
          />
          <Pager offset={offset} total={state.data?.meta.total ?? 0} setOffset={setOffset} />
        </Loaded>
      </Card>
    </>
  );
}

function Pager({ offset, total, setOffset }) {
  const { w, fmt } = useDash();
  if (total <= PAGE) return null;
  return (
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
  );
}
