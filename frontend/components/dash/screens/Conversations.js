'use client';

import { useState } from 'react';
import { useApi, useDash, usePolling } from '../DashProvider';
import { Badge, Button, Empty, LiveDot, Loaded, PageHead, Segmented, StatusBadge } from '../kit';
import { ChatPanel } from './shared';
import s from './screens.module.css';

const PAGE = 30;
const fromUrl = (name) => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name));

/** filter → the API query for it */
const FILTERS = {
  all: '',
  live: '&live=true',
  with_team: '&with_team=true',
  needs_attention: '&status=needs_attention',
  handed_off: '&status=handed_off',
  closed: '&status=closed',
  unreviewed: '&reviewed=no',
  reviewed: '&reviewed=yes',
};

/**
 * S5 Conversations: every chat with the assistant. "Live" shows chats active in the last 10 minutes
 * and updates by itself. Open one to read it (with what the assistant did), take it over and
 * answer, mark it reviewed, or report a wrong answer to the owner.
 */
export default function Conversations() {
  const { w, fmt } = useDash();
  const t = w.conversations;
  const [filter, setFilter] = useState('all');
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState(() => fromUrl('c'));
  const list = useApi(`/staff/conversations?limit=${PAGE}&offset=${offset}${FILTERS[filter]}`);
  usePolling(list.reload, filter === 'live' ? 8000 : 30_000);
  const rows = list.data?.data ?? [];
  const total = list.data?.meta.total ?? 0;

  const choose = (id) => {
    setPicked(id);
    window.history.replaceState(null, '', id ? `?c=${id}` : window.location.pathname);
  };

  return (
    <>
      <PageHead title={w.shell.nav.conversations} sub={t.sub} />
      <div className={s.toolbar}>
        <Segmented value={filter} onChange={(v) => (setFilter(v), setOffset(0))} options={Object.keys(FILTERS).map((k) => [k, t.filters[k]])} label={t.filter} />
      </div>
      <div className={s.split}>
        <div className={`${s.splitList} ${picked ? s.hideOnPhone : ''}`}>
          <Loaded state={list} rows={6} empty={rows.length === 0} emptyText={filter === 'live' ? t.noLive : t.none}>
            <ul className={s.itemList}>
              {rows.map((c) => (
                <li key={c.id}>
                  <button type="button" aria-current={picked === c.id || undefined} onClick={() => choose(c.id)}>
                    <span className={s.itemTop}>
                      <strong>{c.patient_name ?? w.common.unknownPatient}</strong>
                      <small>{fmt.ago(c.last_message_at)}</small>
                    </span>
                    <span className={s.itemText}>{c.title ?? '—'}</span>
                    <span className={s.rowWrap}>
                      {c.live && <LiveDot label={w.common.live} />}
                      <StatusBadge status={c.status} />
                      {c.taken_over_by_name && <Badge tone="violet">{c.taken_over_by_name}</Badge>}
                      {c.reviewed_at && <Badge tone="mint">✓ {w.chat.reviewed}</Badge>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
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
        </div>
        <div className={s.splitDetail}>
          {picked ? (
            <div className={s.stack}>
              <Button size="sm" kind="ghost" className={s.showOnPhone} onClick={() => choose(null)}>
                ← {w.shell.nav.conversations}
              </Button>
              <div className={s.chatCardBig}>
                <ChatPanel key={picked} conversationId={picked} onChanged={list.reload} />
              </div>
            </div>
          ) : (
            <Empty title={t.pick} />
          )}
        </div>
      </div>
    </>
  );
}
