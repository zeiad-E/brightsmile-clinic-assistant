'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { localePath } from '@/i18n/config';
import TimePicker from '@/components/book/TimePicker';
import { useAction, useApi, useDash, useDebounced, useNow, usePolling } from '../DashProvider';
import {
  Avatar,
  Badge,
  Button,
  Confirm,
  Drawer,
  Facts,
  FormGrid,
  Icon,
  LiveDot,
  Modal,
  Notice,
  SearchInput,
  SelectField,
  Skeleton,
  StatusBadge,
  TextField,
  WriteButton,
} from '../kit';
import s from './screens.module.css';

/** Doctors and treatments (public lists), shared by the booking and filter screens. */
export function useCatalog() {
  const doctors = useApi('/doctors');
  const services = useApi('/services');
  return { doctors: doctors.data?.data ?? [], services: services.data?.data ?? [] };
}

const minutesBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 60_000);

/* ====================================================================================
 * One booking: details + done / no-show / move / cancel
 * ==================================================================================== */
export function AppointmentDrawer({ appointment, onClose, onChanged }) {
  const { w, fmt, pick, say, api, locale, can } = useDash();
  const [mode, setMode] = useState(null); // 'move' | 'cancel'
  const [picked, setPicked] = useState(null);
  const [anyDoctor, setAnyDoctor] = useState(false);
  const [reason, setReason] = useState('');
  const [run, busy] = useAction();
  const a = appointment;
  const t = w.appointments;

  const done = async (request, message) => {
    const result = await run(request, { success: message });
    if (result !== undefined) {
      setMode(null);
      onChanged?.();
    }
  };

  const now = useNow();
  const open = Boolean(a);
  // "done" and "no-show" make sense from 15 minutes before the visit
  const started = a && now && new Date(a.starts_at).getTime() <= now + 15 * 60_000;
  return (
    <Drawer
      open={open}
      onClose={() => (setMode(null), onClose())}
      title={a ? pick(a.service, 'name') : ''}
      sub={a ? `${fmt.day(a.starts_at)} · ${fmt.time(a.starts_at)}` : ''}
      footer={
        a?.status === 'booked' && can.write && !mode ? (
          <>
            <Button kind="danger" onClick={() => setMode('cancel')}>
              {t.cancel}
            </Button>
            <Button onClick={() => (setMode('move'), setPicked(null))}>{t.move}</Button>
            {started && (
              <>
                <Button busy={busy} onClick={() => done(() => api(`/staff/appointments/${a.id}/status`, { method: 'PATCH', body: { status: 'no_show' } }), t.markedNoShow)}>
                  {t.noShow}
                </Button>
                <Button kind="primary" busy={busy} onClick={() => done(() => api(`/staff/appointments/${a.id}/status`, { method: 'PATCH', body: { status: 'completed' } }), t.markedDone)}>
                  {t.done}
                </Button>
              </>
            )}
          </>
        ) : null
      }
    >
      {a && (
        <>
          <div className={s.drawerHero}>
            <Avatar name={a.patient.full_name} size={44} />
            <div>
              <Link href={localePath(locale, `/dashboard/patients/${a.patient.id}`)} className={s.strongLink}>
                {a.patient.full_name}
              </Link>
              <p className={s.muted}>{say(t.withDoctor, { doctor: pick(a.doctor, 'full_name') })}</p>
            </div>
            <StatusBadge status={a.status} />
          </div>
          <Facts
            items={[
              [t.when, `${fmt.date(a.starts_at, { weekday: 'long', day: 'numeric', month: 'long' })} · ${fmt.time(a.starts_at)}–${fmt.time(a.ends_at)}`],
              [t.length, say(w.common.minutes, { n: fmt.number(minutesBetween(a.starts_at, a.ends_at)) })],
              [t.source, w.source[a.source] ?? a.source],
              [t.bookedOn, fmt.dateTime(a.created_at)],
              [t.cancelledOn, a.cancelled_at ? fmt.dateTime(a.cancelled_at) : null],
              [t.notes, a.notes],
            ]}
          />
          {a.status === 'booked' && !started && can.write && !mode && <p className={s.muted}>{t.doneLater}</p>}

          {mode === 'move' && (
            <div className={s.panelBox}>
              <div className={s.rowBetween}>
                <strong>{t.pickNew}</strong>
                <label className={s.inlineCheck}>
                  <input type="checkbox" checked={anyDoctor} onChange={(e) => (setAnyDoctor(e.target.checked), setPicked(null))} />
                  {t.anyDoctor}
                </label>
              </div>
              <TimePicker key={String(anyDoctor)} serviceId={a.service.id} staffId={anyDoctor ? null : a.doctor.id} locale={locale} t={w.picker} picked={picked} onPick={setPicked} />
              <div className={s.rowEnd}>
                <Button onClick={() => setMode(null)}>{w.common.cancel}</Button>
                <Button
                  kind="primary"
                  disabled={!picked}
                  busy={busy}
                  onClick={() =>
                    done(() => api(`/staff/appointments/${a.id}/reschedule`, { method: 'POST', body: { starts_at: picked.starts_at, staff_id: picked.staff_id } }), t.moved)
                  }
                >
                  {t.saveMove}
                </Button>
              </div>
            </div>
          )}
          {mode === 'cancel' && (
            <div className={s.panelBox}>
              <TextField label={t.reason} hint={t.reasonHint} value={reason} onChange={setReason} multiline maxLength={300} />
              <div className={s.rowEnd}>
                <Button onClick={() => setMode(null)}>{t.keep}</Button>
                <Button
                  kind="danger"
                  busy={busy}
                  onClick={() => done(() => api(`/staff/appointments/${a.id}/cancel`, { method: 'POST', body: reason.trim() ? { reason: reason.trim() } : {} }), t.cancelled)}
                >
                  {t.yesCancel}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}

/* ====================================================================================
 * New booking for a walk-in or a phone call (optionally for a known patient)
 * ==================================================================================== */
export function BookingDrawer({ open, onClose, onBooked, patient }) {
  const { w } = useDash();
  return (
    <Drawer open={open} onClose={onClose} title={w.booking.title} sub={w.booking.sub} wide>
      <BookingForm patient={patient} onBooked={onBooked} onClose={onClose} />
    </Drawer>
  );
}

const EMPTY_PATIENT = { full_name: '', date_of_birth: '', phone: '', email: '', preferred_language: 'en' };

function BookingForm({ patient: given, onBooked, onClose }) {
  const { w, pick, say, fmt, api, toast, locale } = useDash();
  const t = w.booking;
  const { doctors, services } = useCatalog();
  const [patient, setPatient] = useState(given ?? null); // a chosen existing patient
  const [form, setForm] = useState(EMPTY_PATIENT); // or a new one
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 250);
  const found = useApi(!patient && term.length >= 2 ? `/staff/patients?q=${encodeURIComponent(term)}&limit=5` : null);
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [picked, setPicked] = useState(null);
  const [notes, setNotes] = useState('');
  const [pickerKey, setPickerKey] = useState(0);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // One key per booking attempt: if the network hiccups and we send twice, the clinic gets one booking.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const set = (name) => (value) => setForm((f) => ({ ...f, [name]: value }));
  const offering = doctors.filter((d) => !serviceId || d.service_ids.includes(serviceId));
  const who = patient ?? form;
  const ready = serviceId && picked && who.full_name && who.date_of_birth && (who.phone || who.email);

  async function book() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        service_id: serviceId,
        staff_id: picked.staff_id,
        starts_at: picked.starts_at,
        full_name: who.full_name,
        date_of_birth: who.date_of_birth,
        preferred_language: who.preferred_language ?? 'en',
        ...(who.phone && { phone: who.phone }),
        ...(who.email && { email: who.email }),
        ...(notes.trim() && { notes: notes.trim() }),
      };
      const result = await api('/staff/appointments', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey } });
      toast(t.booked);
      onBooked?.(result.appointment);
      onClose();
    } catch (err) {
      setError(err.message);
      if (err.code === 'slot_taken') {
        setPicked(null);
        setPickerKey((k) => k + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.stack}>
      <section className={s.formSection}>
        <h3>1 · {t.patient}</h3>
        {patient ? (
          <div className={s.chosen}>
            <Avatar name={patient.full_name} size={36} />
            <div>
              <strong>{patient.full_name}</strong>
              <small dir="ltr">{[patient.phone, patient.email].filter(Boolean).join(' · ')}</small>
            </div>
            {!given && (
              <Button size="sm" kind="ghost" onClick={() => setPatient(null)}>
                {t.change}
              </Button>
            )}
          </div>
        ) : (
          <>
            <SearchInput value={q} onChange={setQ} placeholder={t.findPatient} />
            {term.length >= 2 && (
              <div className={s.pickList}>
                {(found.data?.data ?? []).map((p) => (
                  <button key={p.id} type="button" onClick={() => setPatient(p)}>
                    <Avatar name={p.full_name} size={28} />
                    <span>
                      {p.full_name} <small dir="ltr">{p.phone ?? p.email}</small>
                    </span>
                  </button>
                ))}
                {found.data && found.data.data.length === 0 && <p className={s.muted}>{t.noMatch}</p>}
              </div>
            )}
            <p className={s.muted}>{t.orNew}</p>
            <FormGrid>
              <TextField label={w.patient.fullName} value={form.full_name} onChange={set('full_name')} autoComplete="off" />
              <TextField label={w.patient.dob} type="date" value={form.date_of_birth} onChange={set('date_of_birth')} />
              <TextField label={w.patient.phone} hint={w.patient.phoneHint} dir="ltr" value={form.phone} onChange={set('phone')} />
              <TextField label={w.patient.email} type="email" dir="ltr" value={form.email} onChange={set('email')} />
              <SelectField label={w.patient.language} value={form.preferred_language} onChange={set('preferred_language')} options={[['en', w.common.en], ['ar', w.common.ar]]} />
            </FormGrid>
          </>
        )}
      </section>

      <section className={s.formSection}>
        <h3>2 · {t.treatment}</h3>
        <FormGrid>
          <SelectField
            label={t.service}
            value={serviceId}
            onChange={(v) => (setServiceId(v), setPicked(null), setStaffId(''))}
            options={[['', t.chooseService], ...services.map((x) => [x.id, `${pick(x, 'name')} · ${say(w.common.minutes, { n: fmt.number(x.duration_minutes) })} · ${fmt.money(x.price_egp)}`])]}
          />
          <SelectField
            label={t.doctor}
            value={staffId}
            onChange={(v) => (setStaffId(v), setPicked(null))}
            options={[['', t.anyDoctor], ...offering.map((d) => [d.id, pick(d, 'full_name')])]}
          />
        </FormGrid>
      </section>

      <section className={s.formSection}>
        <h3>3 · {t.time}</h3>
        {serviceId ? (
          <TimePicker key={`${serviceId}-${staffId}-${pickerKey}`} serviceId={serviceId} staffId={staffId || null} locale={locale} t={w.picker} picked={picked} onPick={setPicked} />
        ) : (
          <p className={s.muted}>{t.chooseServiceFirst}</p>
        )}
        <TextField label={t.notes} value={notes} onChange={setNotes} multiline maxLength={500} />
      </section>

      {error && <Notice tone="error">{error}</Notice>}
      <div className={s.rowEnd}>
        <Button onClick={onClose}>{w.common.cancel}</Button>
        <WriteButton kind="primary" disabled={!ready} busy={busy} onClick={book}>
          {t.book}
        </WriteButton>
      </div>
    </div>
  );
}

/* ====================================================================================
 * A conversation for the team: transcript (tool calls too), take over, reply, review, report
 * ==================================================================================== */
export function ChatPanel({ conversationId, onChanged, compact }) {
  const { w, fmt, api, locale, can, user, say } = useDash();
  const t = w.chat;
  const state = useApi(conversationId ? `/staff/conversations/${conversationId}` : null);
  const c = state.data;
  const [reply, setReply] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [report, setReport] = useState(null); // { message } being reported
  const [handBackOpen, setHandBackOpen] = useState(false);
  const [run, busy] = useAction();
  const listRef = useRef(null);
  const count = c?.messages.length ?? 0;

  // While a chat is live or a team member is in it, check for new messages every 4 seconds.
  usePolling(state.reload, 4000, Boolean(c && (c.live || c.taken_over_by)));
  // newest message in view: scroll the transcript box itself (never the whole page)
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [count]);

  if (!conversationId) return null;
  if (state.error) return <Notice tone="error">{state.error.message}</Notice>;
  if (!c) return <Skeleton rows={6} height={52} />;

  const mine = c.taken_over_by === user.id;
  const someoneElse = c.taken_over_by && !mine;
  const act = async (request, success) => {
    const result = await run(request, { success });
    if (result) {
      state.setData(result);
      onChanged?.();
    }
    return result;
  };

  const send = async () => {
    const text = reply.trim();
    if (!text) return;
    const saved = await run(() => api(`/staff/conversations/${c.id}/messages`, { method: 'POST', body: { message: text } }), { success: null });
    if (saved) {
      setReply('');
      state.reload();
      onChanged?.();
    }
  };

  return (
    <div className={`${s.chatPanel} ${compact ? s.chatCompact : ''}`}>
      <header className={s.chatHead}>
        <div className={s.chatWho}>
          <Avatar name={c.patient_name ?? '?'} size={38} />
          <div>
            {c.patient_id ? (
              <Link href={localePath(locale, `/dashboard/patients/${c.patient_id}`)} className={s.strongLink}>
                {c.patient_name}
              </Link>
            ) : (
              <strong>{w.common.unknownPatient}</strong>
            )}
            <p className={s.muted}>
              {fmt.dateTime(c.created_at)} · {say(t.turns, { n: fmt.number(c.turn_count) })}
            </p>
          </div>
        </div>
        <div className={s.chatBadges}>
          {c.live && <LiveDot label={w.common.live} />}
          <StatusBadge status={c.status} />
          {c.reviewed_at && <Badge tone="mint">{t.reviewed}</Badge>}
        </div>
      </header>

      {c.taken_over_by && (
        <Notice tone={mine ? 'info' : 'warn'}>{mine ? t.youAreAnswering : say(t.someoneAnswering, { name: c.taken_over_by_name ?? '' })}</Notice>
      )}
      {c.review_note && <Notice>{say(t.reviewNote, { name: c.reviewed_by_name ?? '', note: c.review_note })}</Notice>}

      <ol ref={listRef} className={s.transcript}>
        {c.messages.map((m) => (
          <Message key={m.id} m={m} onReport={can.write ? () => setReport({ message: m }) : null} />
        ))}
      </ol>

      {c.reports?.length > 0 && (
        <div className={s.reports}>
          <strong>{say(t.reportsTitle, { n: fmt.number(c.reports.length) })}</strong>
          {c.reports.map((r) => (
            <p key={r.id}>
              <Badge tone={r.status === 'open' ? 'amber' : 'mint'}>{w.status[r.status]}</Badge> {w.reportKinds[r.kind]} — {r.note}{' '}
              <small>
                {r.reported_by_name} · {fmt.ago(r.created_at)}
              </small>
            </p>
          ))}
        </div>
      )}

      {can.write && (
        <div className={s.chatActions}>
          {!someoneElse && (
            <div className={s.replyBox}>
              <textarea
                value={reply}
                placeholder={mine ? t.replyPlaceholder : t.replyTakesOver}
                rows={2}
                maxLength={2000}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <Button kind="primary" busy={busy} disabled={!reply.trim()} onClick={send} aria-label={t.send}>
                <Icon name="send" /> <span className={s.hideSm}>{t.send}</span>
              </Button>
            </div>
          )}
          <div className={s.rowWrap}>
            {!c.taken_over_by && (
              <Button onClick={() => act(() => api(`/staff/conversations/${c.id}/take-over`, { method: 'POST' }), t.tookOver)}>{t.takeOver}</Button>
            )}
            {c.taken_over_by && <Button onClick={() => setHandBackOpen(true)}>{t.handBack}</Button>}
            {c.reviewed_at ? (
              <Button kind="ghost" onClick={() => act(() => api(`/staff/conversations/${c.id}/review`, { method: 'POST', body: { reviewed: false } }), t.unreviewed)}>
                {t.undoReview}
              </Button>
            ) : (
              <Button onClick={() => (setReviewNote(''), setReviewOpen(true))}>
                <Icon name="check" /> {t.markReviewed}
              </Button>
            )}
          </div>
        </div>
      )}

      <Confirm
        open={handBackOpen}
        title={t.handBack}
        text={t.handBackText}
        busy={busy}
        onClose={() => setHandBackOpen(false)}
        onConfirm={async () => {
          await act(() => api(`/staff/conversations/${c.id}/hand-back`, { method: 'POST' }), t.handedBack);
          setHandBackOpen(false);
        }}
      />
      <Modal
        open={reviewOpen}
        title={t.markReviewed}
        onClose={() => setReviewOpen(false)}
        footer={
          <>
            <Button onClick={() => setReviewOpen(false)}>{w.common.cancel}</Button>
            <Button
              kind="primary"
              busy={busy}
              onClick={async () => {
                await act(() => api(`/staff/conversations/${c.id}/review`, { method: 'POST', body: { reviewed: true, note: reviewNote.trim() || null } }), t.reviewedDone);
                setReviewOpen(false);
              }}
            >
              {t.markReviewed}
            </Button>
          </>
        }
      >
        <TextField label={t.reviewNoteLabel} hint={t.reviewNoteHint} value={reviewNote} onChange={setReviewNote} multiline maxLength={1000} />
      </Modal>
      {report && (
        <ReportModal
          message={report.message}
          onClose={() => setReport(null)}
          onSent={() => {
            setReport(null);
            state.reload();
          }}
          conversationId={c.id}
        />
      )}
    </div>
  );
}

function ReportModal({ conversationId, message, onClose, onSent }) {
  const { w, api } = useDash();
  const t = w.chat;
  const [kind, setKind] = useState('wrong_answer');
  const [note, setNote] = useState('');
  const [run, busy] = useAction();
  return (
    <Modal
      open
      title={t.reportTitle}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{w.common.cancel}</Button>
          <Button
            kind="primary"
            busy={busy}
            disabled={note.trim().length < 3}
            onClick={async () => {
              const done = await run(
                () => api(`/staff/conversations/${conversationId}/reports`, { method: 'POST', body: { kind, note: note.trim(), message_id: message.id } }),
                { success: t.reportSent },
              );
              if (done) onSent();
            }}
          >
            {t.sendReport}
          </Button>
        </>
      }
    >
      <blockquote className={s.quote}>{message.content || message.tool_name}</blockquote>
      <SelectField label={t.reportKind} value={kind} onChange={setKind} options={Object.entries(w.reportKinds)} />
      <TextField label={t.reportNote} hint={t.reportNoteHint} value={note} onChange={setNote} multiline maxLength={1000} />
    </Modal>
  );
}

function Message({ m, onReport }) {
  const { w, fmt, say } = useDash();
  const t = w.chat;
  const [open, setOpen] = useState(false);

  if (m.role === 'tool') {
    const ok = m.tool_payload?.result?.ok !== false;
    return (
      <li className={s.toolLine}>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <Icon name="tool" size={14} /> {say(t.usedTool, { tool: t.tools[m.tool_name] ?? m.tool_name })} {ok ? '✓' : '✗'}
        </button>
        {open && m.tool_payload && <pre dir="ltr">{JSON.stringify(m.tool_payload, null, 2)}</pre>}
      </li>
    );
  }
  if (m.role === 'staff' && !m.content) {
    return <li className={s.eventLine}>{say(m.tool_name === 'left' ? t.left : t.joined, { name: m.author_name ?? '' })}</li>;
  }
  const side = m.role === 'user' ? s.fromPatient : m.role === 'staff' ? s.fromStaff : s.fromAssistant;
  return (
    <li className={`${s.bubbleRow} ${side}`}>
      <div className={s.bubble}>
        <p className={s.bubbleWho}>
          {m.role === 'user' ? t.patient : m.role === 'staff' ? (m.author_name ?? t.team) : t.assistant}
          <time>{fmt.time(m.created_at)}</time>
        </p>
        <p className={s.bubbleText}>{m.content}</p>
        {m.role === 'assistant' && onReport && (
          <button type="button" className={s.reportBtn} onClick={onReport}>
            <Icon name="flag" size={13} /> {t.report}
          </button>
        )}
      </div>
    </li>
  );
}
