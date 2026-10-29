'use client';

import Link from 'next/link';
import { useState } from 'react';
import { localePath } from '@/i18n/config';
import { useAction, useApi, useDash, usePolling } from '../DashProvider';
import { Avatar, Badge, Button, Card, Empty, Facts, Loaded, Notice, PageHead, Segmented, StatusBadge, WriteButton } from '../kit';
import { ChatPanel } from './shared';
import s from './screens.module.css';

const fromUrl = (name) => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name));

/**
 * S4 Inbox: everything the assistant handed to a human, newest first. Open one to see the chat and
 * the patient side by side, reply in the patient's chat (that pauses the assistant there), and
 * mark it resolved when it's handled.
 */
export default function Inbox() {
  const { w, fmt, say } = useDash();
  const t = w.inbox;
  const [status, setStatus] = useState('open');
  const [picked, setPicked] = useState(() => fromUrl('h'));
  const list = useApi(`/staff/escalations?status=${status}&limit=100`);
  usePolling(list.reload, 30_000);
  const rows = list.data?.data ?? [];
  // nothing picked yet → the newest one; '' (after "back" on a phone) → none
  const current = picked === null ? (rows[0] ?? null) : (rows.find((e) => e.id === picked) ?? null);

  const choose = (id) => {
    setPicked(id);
    window.history.replaceState(null, '', id ? `?h=${id}` : window.location.pathname);
  };

  return (
    <>
      <PageHead title={w.shell.nav.inbox} sub={t.sub} />
      <div className={s.split}>
        <div className={`${s.splitList} ${current ? s.hideOnPhone : ''}`}>
          <Segmented
            value={status}
            onChange={(v) => (setStatus(v), setPicked(null))}
            options={[
              ['open', w.status.open, status === 'open' ? list.data?.meta.total : undefined],
              ['resolved', w.status.resolved],
            ]}
            label={t.filter}
          />
          <Loaded state={list} rows={5} empty={rows.length === 0} emptyText={status === 'open' ? t.allClear : t.noneResolved}>
            <ul className={s.itemList}>
              {rows.map((e) => (
                <li key={e.id}>
                  <button type="button" aria-current={current?.id === e.id || undefined} onClick={() => choose(e.id)}>
                    <span className={s.itemTop}>
                      <Badge tone={e.urgency === 'urgent' ? 'red' : e.urgency === 'high' ? 'amber' : e.urgency === 'low' ? 'gray' : 'blue'} dot>
                        {w.urgency[e.urgency]}
                      </Badge>
                      <small>{fmt.ago(e.created_at)}</small>
                    </span>
                    <strong>{e.patient_name ?? w.common.unknownPatient}</strong>
                    <span className={s.itemText}>{e.reason}</span>
                    {e.status === 'resolved' && <small className={s.muted}>{say(t.resolvedAt, { time: fmt.dateTime(e.resolved_at) })}</small>}
                  </button>
                </li>
              ))}
            </ul>
          </Loaded>
        </div>

        <div className={s.splitDetail}>
          {current ? (
            <Handover key={current.id} escalation={current} onBack={() => choose('')} onResolved={list.reload} />
          ) : (
            list.data && <Empty title={t.pick} />
          )}
        </div>
      </div>
    </>
  );
}

function Handover({ escalation: e, onBack, onResolved }) {
  const { w, fmt, pick, say, api, locale } = useDash();
  const t = w.inbox;
  const patient = useApi(e.patient_id ? `/staff/patients/${e.patient_id}` : null);
  const [run, busy] = useAction();
  const next = patient.data?.appointments
    ?.filter((a) => a.status === 'booked' && a.starts_at > e.created_at)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];

  return (
    <div className={s.stack}>
      <Button size="sm" kind="ghost" className={s.showOnPhone} onClick={onBack}>
        ← {w.shell.nav.inbox}
      </Button>
      <Card>
        <div className={s.rowBetween}>
          <div>
            <p className={s.eyebrowSmall}>{say(t.handedAt, { time: fmt.dateTime(e.created_at) })}</p>
            <h2 className={s.h2}>{e.reason}</h2>
          </div>
          {e.status === 'open' ? (
            <WriteButton kind="primary" busy={busy} onClick={async () => (await run(() => api(`/staff/escalations/${e.id}/resolve`, { method: 'POST' }), { success: t.resolved })) && onResolved()}>
              {t.resolve}
            </WriteButton>
          ) : (
            <StatusBadge status="resolved" />
          )}
        </div>
        {e.urgency === 'urgent' && <Notice tone="error">{t.urgentNote}</Notice>}
      </Card>

      <div className={s.handoverGrid}>
        <Card title={t.chat} className={s.chatCard}>
          {e.conversation_id ? <ChatPanel conversationId={e.conversation_id} compact /> : <Empty title={t.noChat} />}
        </Card>
        <Card title={t.patient}>
          {!e.patient_id ? (
            <p className={s.muted}>{t.visitor}</p>
          ) : (
            <Loaded state={patient} rows={3}>
              {patient.data && (
                <div className={s.stack}>
                  <div className={s.chosen}>
                    <Avatar name={patient.data.full_name} size={40} />
                    <div>
                      <Link className={s.strongLink} href={localePath(locale, `/dashboard/patients/${patient.data.id}`)}>
                        {patient.data.full_name}
                      </Link>
                      <small dir="ltr">{patient.data.phone}</small>
                    </div>
                  </div>
                  <Facts
                    items={[
                      [w.patient.email, patient.data.email],
                      [w.patient.language, patient.data.preferred_language === 'ar' ? w.common.ar : w.common.en],
                      [t.visits, fmt.number(patient.data.appointments.length)],
                      [t.nextVisit, next ? `${fmt.day(next.starts_at)} · ${fmt.time(next.starts_at)} · ${pick(next.service, 'name')}` : t.noNext],
                      [w.patient.notes, patient.data.notes],
                    ]}
                  />
                </div>
              )}
            </Loaded>
          )}
        </Card>
      </div>
    </div>
  );
}
