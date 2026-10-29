'use client';

import Link from 'next/link';
import { useState } from 'react';
import { localePath } from '@/i18n/config';
import { useAction, useApi, useDash, useDebounced, usePolling } from '../DashProvider';
import { Avatar, Badge, Button, Card, Confirm, Drawer, Facts, FormGrid, Icon, Loaded, Modal, Notice, PageHead, SearchInput, Segmented, SelectField, Table, TextField, Toggle, WriteButton } from '../kit';
import { HealthBadge } from './Overview';
import s from './screens.module.css';

/**
 * O6 Assistant control room: is the assistant healthy, should it be paused, what went wrong
 * (reports from the team + reviewed chats with notes), what it did (bookings, changes, handovers),
 * what it remembers about patients, and which intake questions it asks.
 */
export default function AssistantRoom() {
  const { w } = useDash();
  const t = w.assistant;
  const [tab, setTab] = useState('health');
  return (
    <>
      <PageHead title={w.shell.nav.assistant} sub={t.sub} />
      <Segmented
        value={tab}
        onChange={setTab}
        label={t.sub}
        options={[
          ['health', t.tabs.health],
          ['problems', t.tabs.problems],
          ['activity', t.tabs.activity],
          ['memory', t.tabs.memory],
          ['intake', t.tabs.intake],
        ]}
      />
      <div className={s.tabBody}>
        {tab === 'health' && <Health />}
        {tab === 'problems' && <Problems />}
        {tab === 'activity' && <Activity />}
        {tab === 'memory' && <Memory />}
        {tab === 'intake' && <Intake />}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- health + pause switch

function Health() {
  const { w, fmt, say, api, can } = useDash();
  const t = w.assistant;
  const status = useApi('/admin/agent/status');
  const settings = useApi('/admin/settings');
  const [confirm, setConfirm] = useState(false);
  const [run, busy] = useAction();
  usePolling(status.reload, 15_000);
  const st = status.data;
  const enabled = settings.data?.assistant_enabled;

  const setEnabled = async (on) => {
    const saved = await run(() => api('/admin/settings', { method: 'PATCH', body: { assistant_enabled: on } }), { success: on ? t.resumed : t.paused });
    if (saved) settings.setData(saved);
    setConfirm(false);
  };

  return (
    <div className={s.stack}>
      <Card title={t.switchTitle}>
        <Loaded state={settings} rows={1}>
          <div className={s.rowBetween}>
            <div>
              <p className={s.h3}>{enabled ? t.on : t.off}</p>
              <p className={s.muted}>{enabled ? t.onHint : t.offHint}</p>
            </div>
            {can.owner ? (
              <Button kind={enabled ? 'danger' : 'primary'} onClick={() => (enabled ? setConfirm(true) : setEnabled(true))}>
                {enabled ? t.pause : t.resume}
              </Button>
            ) : (
              <Badge tone={enabled ? 'mint' : 'red'}>{enabled ? t.on : t.off}</Badge>
            )}
          </div>
        </Loaded>
      </Card>
      <Loaded state={status} rows={3}>
        {st && (
          <div className={s.grid3}>
            <Card title={t.health.title} action={<HealthBadge status={st} />}>
              <Facts
                items={[
                  [t.health.ai, t.health.states[st.ai.state] ?? st.ai.state],
                  [t.health.failures, fmt.number(st.ai.recentFailures)],
                  [t.health.openedAt, st.ai.openedAt ? fmt.dateTime(st.ai.openedAt) : null],
                ]}
              />
              <p className={s.muted}>{t.health.aiHint}</p>
            </Card>
            <Card title={t.queue.title}>
              <Facts
                items={[
                  [t.queue.active, `${fmt.number(st.queue.active)} / ${fmt.number(st.queue.max)}`],
                  [t.queue.waiting, `${fmt.number(st.queue.waiting)} / ${fmt.number(st.queue.queueMax)}`],
                ]}
              />
              <p className={s.muted}>{t.queue.hint}</p>
            </Card>
            <Card title={t.budget.title}>
              <div className={s.meterBar} data-level={st.budget.share >= 1 ? 'off' : st.budget.share >= 0.9 ? 'safe' : 'ok'}>
                <span style={{ width: `${Math.min(100, st.budget.share * 100)}%` }} />
              </div>
              <Facts
                items={[
                  [t.budget.used, `${fmt.percent(st.budget.share)} · ${fmt.number(st.budget.clinicUsed)} / ${fmt.number(st.budget.clinicTokens)}`],
                  [t.budget.people, fmt.number(st.budget.people)],
                  [t.budget.mode, st.budget.share >= 1 ? t.budget.modes.off : st.budget.share >= 0.9 ? t.budget.modes.safe : t.budget.modes.normal],
                ]}
              />
              <p className={s.muted}>{say(t.budget.hint, { day: st.budget.day })}</p>
            </Card>
          </div>
        )}
      </Loaded>
      <Confirm open={confirm} danger title={t.pause} text={t.pauseText} confirmLabel={t.pause} busy={busy} onClose={() => setConfirm(false)} onConfirm={() => setEnabled(false)} />
    </div>
  );
}

// ---------------------------------------------------------------- problem queue

function Problems() {
  const { w, fmt, api, can, locale } = useDash();
  const t = w.assistant;
  const [status, setStatus] = useState('open');
  const reports = useApi(`/admin/agent/reports?status=${status}&limit=100`);
  const reviewed = useApi('/staff/conversations?reviewed=yes&limit=30');
  const [resolving, setResolving] = useState(null);
  const [note, setNote] = useState('');
  const [run, busy] = useAction();
  const rows = reports.data?.data ?? [];
  const notes = (reviewed.data?.data ?? []).filter((c) => c.review_note);
  const chatLink = (id) => `${localePath(locale, '/dashboard/conversations')}?c=${id}`;

  return (
    <div className={s.stack}>
      <Card title={t.reports} action={<Segmented value={status} onChange={setStatus} label={t.reports} options={[['open', w.status.open], ['resolved', w.status.resolved]]} />}>
        <Loaded state={reports} rows={3} empty={rows.length === 0} emptyText={status === 'open' ? t.noReports : t.noResolved}>
          <ul className={s.feed}>
            {rows.map((r) => (
              <li key={r.id}>
                <span className={s.feedIcon} data-tone="amber">
                  <Icon name="flag" size={16} />
                </span>
                <div className={s.grow}>
                  <p>
                    <strong>{w.reportKinds[r.kind]}</strong> · {r.patient_name ?? w.common.unknownPatient}
                  </p>
                  <p className={s.feedText}>{r.note ?? w.common.hiddenInDemo}</p>
                  {r.owner_note && <p className={s.muted}>↳ {r.owner_note}</p>}
                  <p className={s.muted}>
                    {r.reported_by_name} · {fmt.ago(r.created_at)}
                    {r.resolved_at && ` · ${w.status.resolved} ${fmt.ago(r.resolved_at)}`}
                  </p>
                </div>
                <span className={s.rowWrapEnd}>
                  <Link className={s.linkBtnSm} href={chatLink(r.conversation_id)}>
                    {t.openChat}
                  </Link>
                  {can.owner && r.status === 'open' && (
                    <Button size="sm" kind="primary" onClick={() => (setNote(''), setResolving(r))}>
                      {t.resolve}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Loaded>
      </Card>
      <Card title={t.reviewNotes}>
        <Loaded state={reviewed} rows={2} empty={notes.length === 0} emptyText={t.noReviewNotes}>
          <ul className={s.feed}>
            {notes.map((c) => (
              <li key={c.id}>
                <span className={s.feedIcon} data-tone="mint">
                  <Icon name="check" size={16} />
                </span>
                <div className={s.grow}>
                  <p>
                    <strong>{c.patient_name ?? w.common.unknownPatient}</strong> · {c.title ?? '—'}
                  </p>
                  <p className={s.feedText}>{c.review_note}</p>
                  <p className={s.muted}>{fmt.ago(c.reviewed_at)}</p>
                </div>
                <Link className={s.linkBtnSm} href={chatLink(c.id)}>
                  {t.openChat}
                </Link>
              </li>
            ))}
          </ul>
        </Loaded>
      </Card>
      <Modal
        open={Boolean(resolving)}
        title={t.resolve}
        onClose={() => setResolving(null)}
        footer={
          <>
            <Button onClick={() => setResolving(null)}>{w.common.cancel}</Button>
            <Button
              kind="primary"
              busy={busy}
              onClick={async () => {
                await run(() => api(`/admin/agent/reports/${resolving.id}/resolve`, { method: 'POST', body: { owner_note: note.trim() || null } }), { success: t.resolvedNote });
                setResolving(null);
                reports.reload();
              }}
            >
              {t.resolve}
            </Button>
          </>
        }
      >
        <TextField label={t.ownerNote} hint={t.ownerNoteHint} value={note} onChange={setNote} multiline maxLength={1000} />
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- activity feed

const OUTCOME_TONE = { booked: 'mint', changed_data: 'blue', escalated: 'violet', fallback: 'red' };

function Activity() {
  const { w, fmt, locale } = useDash();
  const t = w.assistant;
  const [offset, setOffset] = useState(0);
  const state = useApi(`/admin/agent/activity?limit=30&offset=${offset}`);
  usePolling(state.reload, 30_000, offset === 0);
  const rows = state.data?.data ?? [];
  const total = state.data?.meta.total ?? 0;
  return (
    <Card title={t.activityTitle}>
      <p className={s.muted}>{t.activityHint}</p>
      <Loaded state={state} rows={5} empty={rows.length === 0} emptyText={t.noActivity}>
        <ul className={s.feed}>
          {rows.map((r) => (
            <li key={r.id}>
              <span className={s.feedIcon} data-tone={OUTCOME_TONE[r.outcome]}>
                <Icon name={r.outcome === 'booked' ? 'appointments' : r.outcome === 'escalated' ? 'inbox' : r.outcome === 'fallback' ? 'x' : 'edit'} size={16} />
              </span>
              <div className={s.grow}>
                <p>
                  <Badge tone={OUTCOME_TONE[r.outcome]}>{t.outcomes[r.outcome]}</Badge> {r.patient_name ?? w.common.unknownPatient}
                </p>
                {r.conversation_title && <p className={s.feedText}>“{r.conversation_title}”</p>}
                <p className={s.rowWrap}>
                  {r.tools.map((tool, i) => (
                    <span key={i} className={s.toolChip} data-ok={tool.ok || undefined}>
                      {w.chat.tools[tool.name] ?? tool.name} {tool.ok ? '✓' : '✗'}
                    </span>
                  ))}
                </p>
                <p className={s.muted}>
                  {fmt.dateTime(r.created_at)} · {fmt.number(Math.round(r.latency_ms / 100) / 10)} s
                </p>
              </div>
              {r.conversation_id && (
                <Link className={s.linkBtnSm} href={`${localePath(locale, '/dashboard/conversations')}?c=${r.conversation_id}`}>
                  {t.openChat}
                </Link>
              )}
            </li>
          ))}
        </ul>
        {total > 30 && (
          <div className={s.pager}>
            <Button size="sm" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - 30))}>
              {w.common.prev}
            </Button>
            <span>
              {fmt.number(offset + 1)}–{fmt.number(Math.min(offset + 30, total))} / {fmt.number(total)}
            </span>
            <Button size="sm" disabled={offset + 30 >= total} onClick={() => setOffset((o) => o + 30)}>
              {w.common.next}
            </Button>
          </div>
        )}
      </Loaded>
    </Card>
  );
}

// ---------------------------------------------------------------- memory notes (owner only)

const KINDS = ['preference', 'communication_style', 'logistics'];

function Memory() {
  const { w, fmt, api, can, locale } = useDash();
  const t = w.assistant;
  const state = useApi(can.owner ? '/admin/agent/memories?limit=100' : null);
  const [editing, setEditing] = useState(null); // note or {}
  const [removing, setRemoving] = useState(null);
  const [run, busy] = useAction();
  if (!can.owner) return <Notice>{t.memoryOwnerOnly}</Notice>;
  const rows = state.data?.data ?? [];
  return (
    <>
      <Card
        title={t.memoryTitle}
        flush
        action={
          <WriteButton size="sm" kind="primary" onClick={() => setEditing({})}>
            + {t.addNote}
          </WriteButton>
        }
      >
        <p className={`${s.muted} ${s.cardPad}`}>{t.memoryHint}</p>
        <Loaded state={state} rows={4} empty={rows.length === 0} emptyText={t.noNotes}>
          <Table
            rows={rows}
            onRow={setEditing}
            columns={[
              {
                key: 'patient',
                label: w.chat.patient,
                render: (m) => (
                  <Link className={s.strongLink} href={localePath(locale, `/dashboard/patients/${m.patient_id}`)} onClick={(e) => e.stopPropagation()}>
                    {m.patient_name ?? '—'}
                  </Link>
                ),
              },
              { key: 'kind', label: t.kind, render: (m) => <Badge tone="blue">{t.kinds[m.kind]}</Badge> },
              { key: 'content', label: t.note, render: (m) => m.content },
              { key: 'source', label: t.source, hide: 'sm', render: (m) => t.sources[m.source] ?? m.source },
              { key: 'upd', label: t.updated, hide: 'sm', render: (m) => fmt.date(m.updated_at) },
              {
                key: 'x',
                label: '',
                align: 'end',
                render: (m) => (
                  <Button size="sm" kind="ghost" aria-label={w.common.delete} onClick={(e) => (e.stopPropagation(), setRemoving(m))}>
                    <Icon name="trash" size={16} />
                  </Button>
                ),
              },
            ]}
          />
        </Loaded>
      </Card>
      <Drawer open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? t.editNote : t.addNote}>
        {editing && (
          <MemoryForm
            note={editing}
            onDone={() => {
              setEditing(null);
              state.reload();
            }}
          />
        )}
      </Drawer>
      <Confirm
        open={Boolean(removing)}
        danger
        title={t.deleteNote}
        text={removing?.content}
        confirmLabel={w.common.delete}
        busy={busy}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          await run(() => api(`/admin/agent/memories/${removing.id}`, { method: 'DELETE' }), { success: t.noteDeleted });
          setRemoving(null);
          state.reload();
        }}
      />
    </>
  );
}

function MemoryForm({ note, onDone }) {
  const { w, api } = useDash();
  const t = w.assistant;
  const [patient, setPatient] = useState(note.id ? { id: note.patient_id, full_name: note.patient_name } : null);
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 250);
  const found = useApi(!patient && term.length >= 2 ? `/staff/patients?q=${encodeURIComponent(term)}&limit=5` : null);
  const [kind, setKind] = useState(note.kind ?? 'preference');
  const [content, setContent] = useState(note.content ?? '');
  const [error, setError] = useState(null);
  const [run, busy] = useAction();
  return (
    <div className={s.stack}>
      {patient ? (
        <div className={s.chosen}>
          <Avatar name={patient.full_name} size={34} />
          <strong>{patient.full_name}</strong>
          {!note.id && (
            <Button size="sm" kind="ghost" onClick={() => setPatient(null)}>
              {w.booking.change}
            </Button>
          )}
        </div>
      ) : (
        <>
          <SearchInput value={q} onChange={setQ} placeholder={w.booking.findPatient} />
          <div className={s.pickList}>
            {(found.data?.data ?? []).map((p) => (
              <button key={p.id} type="button" onClick={() => setPatient(p)}>
                <Avatar name={p.full_name} size={28} />
                <span>{p.full_name}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <SelectField label={t.kind} value={kind} onChange={setKind} options={KINDS.map((k) => [k, t.kinds[k]])} />
      <TextField label={t.note} hint={t.noteHint} value={content} onChange={setContent} multiline maxLength={200} />
      {error && <Notice tone="error">{error}</Notice>}
      <div className={s.rowEnd}>
        <Button
          kind="primary"
          busy={busy}
          disabled={!patient || !content.trim()}
          onClick={async () => {
            const body = note.id ? { kind, content: content.trim() } : { patient_id: patient.id, kind, content: content.trim() };
            const saved = await run(() => api(note.id ? `/admin/agent/memories/${note.id}` : '/admin/agent/memories', { method: note.id ? 'PATCH' : 'POST', body }), {
              onError: (err) => setError(err.message),
            });
            if (saved) onDone();
          }}
        >
          {w.common.save}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- intake questions

function Intake() {
  const { w, pick, api, can } = useDash();
  const t = w.assistant;
  const state = useApi('/admin/intake-fields');
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [run, busy] = useAction();
  const rows = [...(state.data?.data ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return (
    <>
      <Card
        title={t.intakeTitle}
        flush
        action={
          can.owner && (
            <Button size="sm" kind="primary" onClick={() => setEditing({})}>
              + {t.addQuestion}
            </Button>
          )
        }
      >
        <p className={`${s.muted} ${s.cardPad}`}>{t.intakeHint}</p>
        <Loaded state={state} rows={3} empty={rows.length === 0}>
          <Table
            rows={rows}
            onRow={can.owner ? setEditing : undefined}
            columns={[
              { key: 'label', label: t.question, render: (f) => <strong>{pick(f, 'label')}</strong> },
              { key: 'kind', label: t.kind, render: (f) => (f.kind === 'choice' ? `${t.choice} · ${f.options.length}` : t.text) },
              { key: 'req', label: t.required, hide: 'sm', render: (f) => (f.required ? w.common.yes : w.common.no) },
              { key: 'on', label: t.asked, render: (f) => (f.is_active ? <Badge tone="mint">{w.common.yes}</Badge> : <Badge>{w.common.no}</Badge>) },
              {
                key: 'x',
                label: '',
                align: 'end',
                render: (f) =>
                  can.owner && (
                    <Button size="sm" kind="ghost" aria-label={w.common.delete} onClick={(e) => (e.stopPropagation(), setRemoving(f))}>
                      <Icon name="trash" size={16} />
                    </Button>
                  ),
              },
            ]}
          />
        </Loaded>
      </Card>
      <Drawer open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? pick(editing, 'label') : t.addQuestion} wide>
        {editing && (
          <IntakeForm
            field={editing}
            nextOrder={rows.length ? Math.max(...rows.map((r) => r.sort_order)) + 1 : 0}
            onDone={() => {
              setEditing(null);
              state.reload();
            }}
          />
        )}
      </Drawer>
      <Confirm
        open={Boolean(removing)}
        danger
        title={t.deleteQuestion}
        text={removing ? pick(removing, 'label') : ''}
        confirmLabel={w.common.delete}
        busy={busy}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          await run(() => api(`/admin/intake-fields/${removing.id}`, { method: 'DELETE' }));
          setRemoving(null);
          state.reload();
        }}
      />
    </>
  );
}

function IntakeForm({ field, nextOrder, onDone }) {
  const { w, api } = useDash();
  const t = w.assistant;
  const [form, setForm] = useState({
    key: field.key ?? '',
    label_en: field.label_en ?? '',
    label_ar: field.label_ar ?? '',
    kind: field.kind ?? 'text',
    options: field.options ?? [],
    required: field.required ?? false,
    sort_order: String(field.sort_order ?? nextOrder),
    is_active: field.is_active ?? true,
  });
  const [error, setError] = useState(null);
  const [run, busy] = useAction();
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const setOption = (i, k, v) => setForm((f) => ({ ...f, options: f.options.map((o, j) => (j === i ? { ...o, [k]: v } : o)) }));

  return (
    <div className={s.stack}>
      <FormGrid>
        <TextField label={t.labelEn} value={form.label_en} onChange={set('label_en')} />
        <TextField label={t.labelAr} dir="rtl" value={form.label_ar} onChange={set('label_ar')} />
        <TextField label={t.key} dir="ltr" hint={t.keyHint} disabled={Boolean(field.id)} value={form.key} onChange={(v) => set('key')(v.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} />
        <SelectField label={t.kind} value={form.kind} onChange={set('kind')} options={[['text', t.text], ['choice', t.choice]]} />
        <TextField label={t.order} type="number" min={0} value={form.sort_order} onChange={set('sort_order')} />
      </FormGrid>
      {form.kind === 'choice' && (
        <div className={s.panelBox}>
          <strong>{t.options}</strong>
          {form.options.map((o, i) => (
            <div key={i} className={s.optionRow}>
              <input className={s.smallInput} dir="ltr" placeholder={t.value} value={o.value} onChange={(e) => setOption(i, 'value', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} />
              <input className={s.smallInput} placeholder="English" value={o.label_en} onChange={(e) => setOption(i, 'label_en', e.target.value)} />
              <input className={s.smallInput} dir="rtl" placeholder="العربية" value={o.label_ar} onChange={(e) => setOption(i, 'label_ar', e.target.value)} />
              <Button size="sm" kind="ghost" aria-label={w.common.delete} onClick={() => setForm((f) => ({ ...f, options: f.options.filter((_, j) => j !== i) }))}>
                <Icon name="x" size={14} />
              </Button>
            </div>
          ))}
          <Button size="sm" onClick={() => setForm((f) => ({ ...f, options: [...f.options, { value: '', label_en: '', label_ar: '' }] }))}>
            + {t.addOption}
          </Button>
        </div>
      )}
      <div className={s.rowWrap}>
        <Toggle checked={form.required} onChange={set('required')} label={t.required} />
        <Toggle checked={form.is_active} onChange={set('is_active')} label={t.asked} />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className={s.rowEnd}>
        <Button
          kind="primary"
          busy={busy}
          disabled={!form.label_en.trim() || !form.label_ar.trim() || !form.key}
          onClick={async () => {
            const { key, ...rest } = form;
            const body = { ...rest, sort_order: Number(form.sort_order), options: form.kind === 'choice' ? form.options : [], ...(field.id ? {} : { key }) };
            const saved = await run(() => api(field.id ? `/admin/intake-fields/${field.id}` : '/admin/intake-fields', { method: field.id ? 'PATCH' : 'POST', body }), {
              onError: (err) => setError(err.details?.fields ? Object.values(err.details.fields).flat().join(' ') : err.message),
            });
            if (saved) onDone();
          }}
        >
          {w.common.save}
        </Button>
      </div>
    </div>
  );
}

