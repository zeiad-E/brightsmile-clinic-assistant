'use client';

import { useState } from 'react';
import { useAction, useApi, useDash, useDebounced, usePolling } from '../DashProvider';
import { Badge, Button, Card, Confirm, Drawer, Facts, FormGrid, Icon, Loaded, Notice, PageHead, SearchInput, Segmented, SelectField, StatusBadge, Table, TextField, Toggle, WriteButton } from '../kit';
import s from './screens.module.css';

const CATEGORIES = ['services', 'pricing', 'hours', 'insurance', 'policies', 'prep', 'location', 'faq', 'other'];
const slugify = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/**
 * O5 Knowledge base: what the assistant reads before it answers. Write a document or upload a file
 * (PDF, Word, text); each is split into passages and indexed in the background (status: waiting →
 * processing → ready). "Unanswered questions" lists what patients asked that the assistant couldn't
 * answer — write the answer and the question is marked done.
 */
export default function Knowledge() {
  const { w } = useDash();
  const t = w.knowledge;
  const [tab, setTab] = useState('docs');
  const [compose, setCompose] = useState(null); // { mode: 'write' | 'upload', preset?, gap? }
  const [docsTick, setDocsTick] = useState(0);
  return (
    <>
      <PageHead title={w.shell.nav.knowledge} sub={t.sub}>
        <WriteButton onClick={() => setCompose({ mode: 'upload' })}>
          <Icon name="upload" size={16} /> {t.upload}
        </WriteButton>
        <WriteButton kind="primary" onClick={() => setCompose({ mode: 'write' })}>
          + {t.write}
        </WriteButton>
      </PageHead>
      <Segmented
        value={tab}
        onChange={setTab}
        label={t.tabs}
        options={[
          ['docs', t.docs],
          ['gaps', t.gaps],
        ]}
      />
      <div className={s.tabBody}>
        {tab === 'docs' ? <Documents key={docsTick} /> : <Gaps onAnswer={(gap) => setCompose({ mode: 'write', preset: { title: gap.question, language: gap.language, category: 'faq' }, gap })} />}
      </div>
      <Drawer open={Boolean(compose)} onClose={() => setCompose(null)} title={compose?.mode === 'upload' ? t.upload : t.write} wide>
        {compose && (
          <Composer
            mode={compose.mode}
            preset={compose.preset}
            gap={compose.gap}
            onDone={() => {
              setCompose(null);
              setDocsTick((n) => n + 1);
            }}
          />
        )}
      </Drawer>
    </>
  );
}

function Documents() {
  const { w, fmt } = useDash();
  const t = w.knowledge;
  const [language, setLanguage] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 300);
  const [open, setOpen] = useState(null);
  const query = new URLSearchParams({ limit: '100', ...(language && { language }), ...(category && { category }), ...(term && { q: term }) });
  const state = useApi(`/admin/knowledge?${query}`);
  const rows = state.data?.data ?? [];
  const busy = rows.some((d) => d.ingest_status === 'pending' || d.ingest_status === 'processing');
  usePolling(state.reload, 5000, busy);

  return (
    <>
      <div className={s.toolbar}>
        <div className={s.grow}>
          <SearchInput value={q} onChange={setQ} placeholder={t.search} />
        </div>
        <div className={s.filters}>
          <SelectField label={w.patient.language} value={language} onChange={setLanguage} options={[['', w.common.all], ['en', w.common.en], ['ar', w.common.ar]]} />
          <SelectField label={t.category} value={category} onChange={setCategory} options={[['', w.common.all], ...CATEGORIES.map((c) => [c, t.categories[c]])]} />
        </div>
      </div>
      <Card flush>
        <Loaded state={state} rows={6} empty={rows.length === 0} emptyText={t.none}>
          <Table
            rows={rows}
            onRow={setOpen}
            columns={[
              {
                key: 'title',
                label: t.title,
                render: (d) => (
                  <span>
                    <strong>{d.title}</strong>
                    <small className={s.blockMuted}>{d.file_name ?? t.typed}</small>
                  </span>
                ),
              },
              { key: 'lang', label: w.patient.language, render: (d) => <Badge>{d.language.toUpperCase()}</Badge> },
              { key: 'cat', label: t.category, hide: 'sm', render: (d) => t.categories[d.category] },
              { key: 'status', label: t.status, render: (d) => <StatusBadge status={d.ingest_status} /> },
              { key: 'pub', label: t.published, hide: 'sm', render: (d) => (d.is_published ? <Badge tone="mint">{w.common.yes}</Badge> : <Badge>{w.common.no}</Badge>) },
              { key: 'upd', label: t.updated, hide: 'sm', render: (d) => fmt.date(d.updated_at) },
            ]}
          />
        </Loaded>
      </Card>
      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title={open?.title ?? ''} wide>
        {open && (
          <DocEditor
            key={open.id}
            id={open.id}
            onChanged={state.reload}
            onRemoved={() => {
              setOpen(null);
              state.reload();
            }}
          />
        )}
      </Drawer>
    </>
  );
}

function DocEditor({ id, onChanged, onRemoved }) {
  const { w, fmt, api, can } = useDash();
  const t = w.knowledge;
  const state = useApi(`/admin/knowledge/${id}`);
  const d = state.data;
  return (
    <Loaded state={state} rows={5}>
      {d && (
        <DocForm
          doc={d}
          facts={[
            [t.status, <StatusBadge key="s" status={d.ingest_status} />],
            [t.passages, fmt.number(d.chunks ?? 0)],
            [t.file, d.file_name],
            [t.updated, fmt.dateTime(d.updated_at)],
          ]}
          canWrite={can.owner}
          onSaved={() => {
            state.reload();
            onChanged();
          }}
          onRemoved={onRemoved}
          api={api}
        />
      )}
    </Loaded>
  );
}

function DocForm({ doc, facts, canWrite, onSaved, onRemoved, api }) {
  const { w } = useDash();
  const t = w.knowledge;
  const typed = doc.source_type === 'manual';
  const initial = { title: doc.title, group_key: doc.group_key, language: doc.language, category: doc.category, is_published: doc.is_published, ...(typed && { content: doc.content ?? '' }) };
  const [form, setForm] = useState(initial);
  const [confirm, setConfirm] = useState(null); // 'delete' | 'reingest'
  const [run, busy] = useAction();
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const changes = Object.fromEntries(Object.keys(form).filter((k) => form[k] !== initial[k]).map((k) => [k, form[k]]));

  return (
    <div className={s.stack}>
      <Facts items={facts} />
      {doc.ingest_error && <Notice tone="error">{doc.ingest_error}</Notice>}
      <FormGrid>
        <TextField label={t.title} value={form.title} onChange={set('title')} wide />
        <TextField label={t.groupKey} dir="ltr" hint={t.groupHint} value={form.group_key} onChange={(v) => set('group_key')(slugify(v) || v.toLowerCase())} />
        <SelectField label={w.patient.language} value={form.language} onChange={set('language')} options={[['en', w.common.en], ['ar', w.common.ar]]} />
        <SelectField label={t.category} value={form.category} onChange={set('category')} options={CATEGORIES.map((c) => [c, t.categories[c]])} />
      </FormGrid>
      {typed ? (
        <TextField label={t.content} value={form.content} onChange={set('content')} multiline rows={14} dir={form.language === 'ar' ? 'rtl' : 'ltr'} maxLength={40000} />
      ) : (
        <details className={s.preview}>
          <summary>{t.extracted}</summary>
          <pre dir={doc.language === 'ar' ? 'rtl' : 'ltr'}>{doc.content || '—'}</pre>
        </details>
      )}
      <Toggle checked={form.is_published} onChange={set('is_published')} label={t.publishedLabel} disabled={!canWrite} />
      {canWrite && (
        <div className={s.rowEnd}>
          <Button kind="danger" onClick={() => setConfirm('delete')}>
            {w.common.delete}
          </Button>
          <Button onClick={() => setConfirm('reingest')}>
            <Icon name="refresh" size={16} /> {t.reingest}
          </Button>
          <Button
            kind="primary"
            busy={busy}
            disabled={!Object.keys(changes).length}
            onClick={async () => (await run(() => api(`/admin/knowledge/${doc.id}`, { method: 'PATCH', body: changes }))) && onSaved()}
          >
            {w.common.save}
          </Button>
        </div>
      )}
      <Confirm
        open={Boolean(confirm)}
        danger={confirm === 'delete'}
        title={confirm === 'delete' ? w.common.delete : t.reingest}
        text={confirm === 'delete' ? t.deleteText : t.reingestText}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm === 'delete') {
            const done = await run(() => api(`/admin/knowledge/${doc.id}`, { method: 'DELETE' }), { success: t.deleted });
            setConfirm(null);
            if (done !== undefined) onRemoved();
          } else {
            await run(() => api(`/admin/knowledge/${doc.id}/reingest`, { method: 'POST' }), { success: t.reingesting });
            setConfirm(null);
            onSaved();
          }
        }}
      />
    </div>
  );
}

function Composer({ mode, preset = {}, gap, onDone }) {
  const { w, api, toast } = useDash();
  const t = w.knowledge;
  const [form, setForm] = useState({
    title: preset.title ?? '',
    group_key: slugify(preset.title),
    language: preset.language ?? 'en',
    category: preset.category ?? 'faq',
    content: '',
    is_published: true,
  });
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'upload') {
        const data = new FormData();
        data.append('file', file);
        data.append('group_key', form.group_key);
        data.append('language', form.language);
        data.append('category', form.category);
        data.append('is_published', String(form.is_published));
        if (form.title.trim()) data.append('title', form.title.trim());
        await api('/admin/knowledge/upload', { method: 'POST', body: data, timeout: 120_000 });
      } else {
        await api('/admin/knowledge', { method: 'POST', body: { ...form, title: form.title.trim(), content: form.content.trim() } });
        if (gap) await api(`/admin/knowledge-gaps/${gap.id}`, { method: 'PATCH', body: { status: 'resolved' } });
      }
      toast(mode === 'upload' ? t.uploaded : t.saved);
      onDone();
    } catch (err) {
      setError(err.details?.fields ? Object.values(err.details.fields).flat().join(' ') : err.message);
    } finally {
      setBusy(false);
    }
  }

  const ready = form.group_key && (mode === 'upload' ? file : form.title.trim() && form.content.trim().length >= 20);
  return (
    <div className={s.stack}>
      {gap && <Notice>{t.answeringGap}</Notice>}
      <FormGrid>
        <TextField label={mode === 'upload' ? `${t.title} (${w.common.optional})` : t.title} value={form.title} wide onChange={(v) => setForm((f) => ({ ...f, title: v, group_key: f.group_key === slugify(f.title) ? slugify(v) : f.group_key }))} />
        <TextField label={t.groupKey} dir="ltr" hint={t.groupHint} value={form.group_key} onChange={(v) => set('group_key')(v.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} />
        <SelectField label={w.patient.language} value={form.language} onChange={set('language')} options={[['en', w.common.en], ['ar', w.common.ar]]} />
        <SelectField label={t.category} value={form.category} onChange={set('category')} options={CATEGORIES.map((c) => [c, t.categories[c]])} />
      </FormGrid>
      {mode === 'upload' ? (
        <label className={s.dropZone}>
          <Icon name="upload" size={22} />
          <span>{file ? `${file.name} · ${Math.ceil(file.size / 1024)} KB` : t.pickFile}</span>
          <small>{t.fileHint}</small>
          <input type="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      ) : (
        <TextField label={t.content} hint={t.contentHint} value={form.content} onChange={set('content')} multiline rows={12} dir={form.language === 'ar' ? 'rtl' : 'ltr'} maxLength={40000} />
      )}
      <Toggle checked={form.is_published} onChange={set('is_published')} label={t.publishedLabel} />
      {error && <Notice tone="error">{error}</Notice>}
      <div className={s.rowEnd}>
        <Button kind="primary" busy={busy} disabled={!ready} onClick={save}>
          {mode === 'upload' ? t.upload : t.save}
        </Button>
      </div>
    </div>
  );
}

function Gaps({ onAnswer }) {
  const { w, fmt, say, api, can } = useDash();
  const t = w.knowledge;
  const [status, setStatus] = useState('open');
  const state = useApi(`/admin/knowledge-gaps?status=${status}&limit=100`);
  const [run] = useAction();
  const rows = state.data?.data ?? [];
  const setGap = async (gap, next) => {
    await run(() => api(`/admin/knowledge-gaps/${gap.id}`, { method: 'PATCH', body: { status: next } }), { success: t.gapUpdated });
    state.reload();
  };
  return (
    <div className={s.stack}>
      <p className={s.muted}>{t.gapsHint}</p>
      <Segmented
        value={status}
        onChange={setStatus}
        label={t.gaps}
        options={[
          ['open', w.status.open],
          ['resolved', w.status.resolved],
          ['ignored', w.status.ignored],
        ]}
      />
      <Card flush>
        <Loaded state={state} rows={5} empty={rows.length === 0} emptyText={t.noGaps}>
          <Table
            rows={rows}
            columns={[
              { key: 'q', label: t.question, render: (g) => <span dir={g.language === 'ar' ? 'rtl' : 'ltr'}>{g.question}</span> },
              { key: 'n', label: t.asked, align: 'end', render: (g) => say(t.timesN, { n: fmt.number(g.count) }) },
              { key: 'last', label: t.lastAsked, hide: 'sm', render: (g) => fmt.ago(g.last_seen_at) },
              {
                key: 'x',
                label: '',
                align: 'end',
                render: (g) =>
                  can.owner && (
                    <span className={s.rowWrapEnd}>
                      {g.status === 'open' ? (
                        <>
                          <Button size="sm" kind="primary" onClick={() => onAnswer(g)}>
                            {t.answer}
                          </Button>
                          <Button size="sm" kind="ghost" onClick={() => setGap(g, 'ignored')}>
                            {t.ignore}
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" kind="ghost" onClick={() => setGap(g, 'open')}>
                          {t.reopen}
                        </Button>
                      )}
                    </span>
                  ),
              },
            ]}
          />
        </Loaded>
      </Card>
    </div>
  );
}
