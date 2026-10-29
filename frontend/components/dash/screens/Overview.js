'use client';

import Link from 'next/link';
import { useState } from 'react';
import { localePath } from '@/i18n/config';
import { addDays, clinicDay, useApi, useDash } from '../DashProvider';
import { Badge, Card, Empty, Loaded, PageHead, Segmented, Stat, Table, TextField } from '../kit';
import { CATEGORY_COLORS, Columns, Donut, Heatmap, HBars } from '../charts';
import s from './screens.module.css';

const weekStart = (day) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 1) % 7));

function periodOf(key, today, custom) {
  if (key === 'week') return { from: weekStart(today), to: today };
  if (key === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (key === '30') return { from: addDays(today, -29), to: today };
  if (key === '90') return { from: addDays(today, -89), to: today };
  return custom;
}

/** Change against the previous period: relative for counts and money, points for rates. */
const change = (now, before, rate = false) => {
  if (now == null || before == null) return null;
  if (rate) return now - before;
  return before ? (now - before) / before : null;
};

/**
 * O1 Overview (owner home): how the clinic did over a period, compared with the period just before
 * it. Bookings, money (from treatment prices), no-shows, how much the assistant handled, busy hours,
 * top treatments, doctors. Plus today's open handovers and the assistant's health.
 */
export default function Overview() {
  const { w, fmt, pick, say, locale } = useDash();
  const t = w.overview;
  const today = clinicDay();
  const [key, setKey] = useState('month');
  const [custom, setCustom] = useState({ from: addDays(today, -6), to: today });
  const period = periodOf(key, today, custom);
  const valid = period.from && period.to && period.from <= period.to;
  const state = useApi(valid ? `/admin/stats?from=${period.from}&to=${period.to}` : null);
  const handovers = useApi('/staff/escalations?status=open&limit=1');
  const health = useApi('/admin/agent/status');
  const d = state.data;
  const cur = d?.totals;
  const prev = d?.previous;
  const vs = d ? say(t.vs, { from: fmt.date(`${d.previous_from}T12:00:00Z`, { day: 'numeric', month: 'short' }), to: fmt.date(`${d.previous_to}T12:00:00Z`, { day: 'numeric', month: 'short' }) }) : '';

  const dayLabels = [6, 0, 1, 2, 3, 4, 5].map((wd) => [wd, fmt.date(`2026-10-${String(4 + wd).padStart(2, '0')}T12:00:00Z`, { weekday: 'short' })]);
  const busyHours = d?.heatmap.length ? d.heatmap.map((c) => c.hour) : [9, 17];
  const hours = Array.from({ length: Math.max(...busyHours, 17) - Math.min(...busyHours, 9) + 1 }, (_, i) => Math.min(...busyHours, 9) + i);

  return (
    <>
      <PageHead title={w.shell.nav.overview} sub={t.sub}>
        <Segmented
          value={key}
          onChange={setKey}
          label={t.period}
          options={[
            ['week', t.thisWeek],
            ['month', t.thisMonth],
            ['30', t.last30],
            ['90', t.last90],
            ['custom', t.custom],
          ]}
        />
      </PageHead>
      {key === 'custom' && (
        <div className={s.toolbar}>
          <div className={s.filters}>
            <TextField label={w.common.from} type="date" value={custom.from} max={custom.to} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} />
            <TextField label={w.common.to} type="date" value={custom.to} min={custom.from} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} />
          </div>
        </div>
      )}

      <div className={s.glance}>
        <Link href={localePath(locale, '/dashboard/inbox')} className={s.glanceItem}>
          <span>{t.openHandovers}</span>
          <strong data-alert={handovers.data?.meta.total > 0 || undefined}>{handovers.data ? fmt.number(handovers.data.meta.total) : '…'}</strong>
        </Link>
        <Link href={localePath(locale, '/owner/assistant')} className={s.glanceItem}>
          <span>{t.assistantHealth}</span>
          {health.data ? <HealthBadge status={health.data} /> : <strong>…</strong>}
        </Link>
        <p className={s.glanceNote}>{d ? `${fmt.date(`${period.from}T12:00:00Z`)} – ${fmt.date(`${period.to}T12:00:00Z`)} · ${vs}` : ''}</p>
      </div>

      <Loaded state={state} rows={4}>
        {d && (
          <div className={s.stack}>
            <div className={s.stats}>
              <Stat label={t.visits} value={fmt.number(cur.visits)} delta={change(cur.visits, prev.visits)} hint={say(t.visitsHint, { done: fmt.number(cur.completed), upcoming: fmt.number(cur.upcoming) })} />
              <Stat label={t.earned} value={fmt.money(cur.revenue_earned)} delta={change(cur.revenue_earned, prev.revenue_earned)} hint={t.earnedHint} />
              <Stat label={t.expected} value={fmt.money(cur.revenue_expected)} hint={t.expectedHint} />
              <Stat label={t.noShowRate} value={fmt.percent(cur.no_show_rate)} delta={change(cur.no_show_rate, prev.no_show_rate, true)} invert hint={say(t.noShowHint, { n: fmt.number(cur.no_show) })} />
              <Stat label={t.aiHandled} value={fmt.percent(cur.ai_handled_rate)} delta={change(cur.ai_handled_rate, prev.ai_handled_rate, true)} hint={say(t.aiHandledHint, { n: fmt.number(cur.ai_turns) })} />
              <Stat label={t.aiBookings} value={fmt.number(cur.ai_bookings)} delta={change(cur.ai_bookings, prev.ai_bookings)} hint={say(t.aiBookingsHint, { share: fmt.percent(cur.ai_booking_share) })} />
              <Stat label={t.newPatients} value={fmt.number(cur.new_patients)} delta={change(cur.new_patients, prev.new_patients)} />
              <Stat label={t.handovers} value={fmt.number(cur.escalations)} delta={change(cur.escalations, prev.escalations)} invert hint={say(t.cancelledHint, { n: fmt.number(cur.cancelled) })} />
            </div>

            <div className={s.grid2}>
              <Card title={t.visitsByDay}>
                <Columns label={t.visitsByDay} data={d.by_day.map((x) => ({ key: x.day, label: fmt.date(`${x.day}T12:00:00Z`, { day: 'numeric' }), title: fmt.day(`${x.day}T12:00:00Z`), value: x.visits }))} format={(n) => fmt.number(n)} />
              </Card>
              <Card title={t.revenueByDay}>
                <Columns label={t.revenueByDay} data={d.by_day.map((x) => ({ key: x.day, label: fmt.date(`${x.day}T12:00:00Z`, { day: 'numeric' }), title: fmt.day(`${x.day}T12:00:00Z`), value: x.revenue }))} format={(n) => fmt.money(n)} />
              </Card>
            </div>

            <div className={s.grid2}>
              <Card title={t.busyHours}>
                {d.heatmap.length ? <Heatmap cells={d.heatmap} dayLabels={dayLabels} hours={hours} format={(n) => say(t.visitsN, { n: fmt.number(n) })} emptyLabel={t.noVisits} /> : <Empty title={t.noVisits} />}
                <p className={s.muted}>{t.busyHint}</p>
              </Card>
              <Card title={t.topTreatments}>
                {d.top_services.length ? (
                  <HBars data={d.top_services.map((x) => ({ key: x.service_id, label: pick(x, 'name'), value: x.visits, display: `${fmt.number(x.visits)} · ${fmt.money(x.revenue)}` }))} />
                ) : (
                  <Empty title={t.noVisits} />
                )}
              </Card>
            </div>

            <div className={s.grid2}>
              <Card title={t.sources}>
                <Donut
                  parts={['patient_assistant', 'dashboard', 'staff_assistant']
                    .map((k, i) => ({ key: k, label: w.source[k], value: d.by_source[k] ?? 0, color: CATEGORY_COLORS[i] }))
                    .filter((p) => p.value > 0 || p.key !== 'staff_assistant')}
                  center={fmt.number(cur.visits)}
                  sub={t.visits}
                  format={(n) => fmt.number(n)}
                />
              </Card>
              <Card title={t.aiOutcomes}>
                <AiOutcomes outcomes={d.ai_outcomes} />
              </Card>
            </div>

            <Card title={t.doctors} flush>
              {d.by_doctor.length ? (
                <Table
                  rowKey={(r) => r.staff_id}
                  rows={d.by_doctor}
                  columns={[
                    { key: 'name', label: t.doctor, render: (r) => pick(r, 'name') },
                    { key: 'visits', label: t.visits, align: 'end', render: (r) => fmt.number(r.visits) },
                    { key: 'done', label: w.status.completed, align: 'end', render: (r) => fmt.number(r.completed) },
                    { key: 'ns', label: w.status.no_show, align: 'end', render: (r) => fmt.number(r.no_show) },
                    { key: 'rate', label: t.noShowRate, align: 'end', hide: 'sm', render: (r) => fmt.percent(r.completed + r.no_show ? r.no_show / (r.completed + r.no_show) : null) },
                  ]}
                />
              ) : (
                <Empty title={t.noVisits} />
              )}
            </Card>
          </div>
        )}
      </Loaded>
    </>
  );
}

function AiOutcomes({ outcomes }) {
  const { w, fmt } = useDash();
  const t = w.today;
  const n = (keys) => keys.reduce((sum, k) => sum + (outcomes[k] ?? 0), 0);
  const parts = [
    { key: 'handled', label: t.aiHandled, value: n(['answered', 'booked', 'changed_data']) },
    { key: 'handed', label: t.aiHanded, value: n(['escalated']) },
    { key: 'declined', label: t.aiDeclined, value: n(['refused']) },
    { key: 'failed', label: t.aiFailed, value: n(['fallback', 'error']) },
  ];
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  if (!total) return <Empty title={t.aiNone} />;
  return <Donut parts={parts} center={fmt.percent(parts[0].value / total)} sub={t.aiHandledShort} format={(x) => fmt.number(x)} />;
}

/** Green when all is well; amber when the AI is struggling or in safe mode; red when it's off. */
export function HealthBadge({ status }) {
  const { w } = useDash();
  const t = w.assistant;
  if (status.ai.state === 'open' || status.budget.share >= 1) return <Badge tone="red" dot>{t.health.down}</Badge>;
  if (status.ai.state !== 'closed' || status.budget.share >= 0.9) return <Badge tone="amber" dot>{t.health.limited}</Badge>;
  return (
    <Badge tone="mint" dot>
      {t.health.ok}
    </Badge>
  );
}
