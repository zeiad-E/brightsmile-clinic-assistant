import { requireAdmin } from '../db/supabase.js';
import * as agentRunModel from '../models/agentRunModel.js';
import * as auditModel from '../models/auditModel.js';
import * as conversationModel from '../models/conversationModel.js';
import * as patientModel from '../models/patientModel.js';
import * as notificationModel from '../models/notificationModel.js';
import * as statsModel from '../models/statsModel.js';
import { listView } from '../views/listView.js';
import { addDays, CLINIC_TIMEZONE, dayInZone, startOfDayInZone } from '../utils/clinicTime.js';

/** Read-only dashboards: today's numbers, the audit log, sent emails. */

export function statsToday({ db }) {
  return statsModel.today(db);
}

export function upcomingByDoctor({ db }) {
  return statsModel.upcomingByDoctor(db);
}

/** Last 7 days: how many assistant turns ended as answered / booked / escalated / refused / fallback. */
export function aiOutcomes({ db }) {
  return statsModel.aiOutcomes(db);
}

export async function auditLog({ db }, filters) {
  return listView(await auditModel.list(db, filters), filters);
}

export async function notifications({ db }, filters) {
  return listView(await notificationModel.list(db, filters), filters);
}

// ----- the owner's overview for any period (G9) -----
// Raw rows are read with the server key (after the route's owner/viewer check) and only totals
// leave this function, so nobody's personal details are in the answer.

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const AI_HANDLED = ['answered', 'booked', 'changed_data'];

function clockParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { weekday: WEEKDAYS[get('weekday')], hour: Number(get('hour')) };
}

/** Adds up one period. Pure (no database), so the numbers are easy to test. */
export function summarize({ appointments, runs, newPatients, escalations, from, to, timeZone = CLINIC_TIMEZONE }) {
  const live = appointments.filter((a) => a.status !== 'cancelled');
  const price = (a) => Number(a.service?.price_egp ?? 0);
  const count = (status) => appointments.filter((a) => a.status === status).length;
  const completed = count('completed');
  const noShow = count('no_show');

  const days = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push({ day, visits: 0, revenue: 0 });
  const dayIndex = new Map(days.map((d, i) => [d.day, i]));
  const heat = new Map();
  const services = new Map();
  const doctors = new Map();
  const bySource = {};

  for (const a of live) {
    const day = days[dayIndex.get(dayInZone(new Date(a.starts_at), timeZone))];
    if (day) {
      day.visits += 1;
      if (a.status !== 'no_show') day.revenue += price(a);
    }
    const { weekday, hour } = clockParts(a.starts_at, timeZone);
    heat.set(`${weekday}-${hour}`, (heat.get(`${weekday}-${hour}`) ?? 0) + 1);
    bySource[a.source] = (bySource[a.source] ?? 0) + 1;

    const service = services.get(a.service_id) ?? { service_id: a.service_id, name_en: a.service?.name_en, name_ar: a.service?.name_ar, visits: 0, revenue: 0 };
    service.visits += 1;
    if (a.status !== 'no_show') service.revenue += price(a);
    services.set(a.service_id, service);

    const doctor = doctors.get(a.staff_id) ?? { staff_id: a.staff_id, name_en: a.doctor?.full_name_en, name_ar: a.doctor?.full_name_ar, visits: 0, completed: 0, no_show: 0 };
    doctor.visits += 1;
    if (a.status === 'completed') doctor.completed += 1;
    if (a.status === 'no_show') doctor.no_show += 1;
    doctors.set(a.staff_id, doctor);
  }

  const outcomes = {};
  for (const r of runs) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
  const aiTurns = runs.length;
  const aiHandled = AI_HANDLED.reduce((sum, key) => sum + (outcomes[key] ?? 0), 0);

  return {
    totals: {
      visits: live.length,
      completed,
      no_show: noShow,
      upcoming: count('booked'),
      cancelled: count('cancelled'),
      revenue_earned: live.filter((a) => a.status === 'completed').reduce((sum, a) => sum + price(a), 0),
      revenue_expected: live.filter((a) => a.status === 'booked').reduce((sum, a) => sum + price(a), 0),
      no_show_rate: completed + noShow ? noShow / (completed + noShow) : null,
      new_patients: newPatients,
      escalations,
      ai_turns: aiTurns,
      ai_handled_rate: aiTurns ? aiHandled / aiTurns : null,
      ai_bookings: bySource.patient_assistant ?? 0,
      ai_booking_share: live.length ? (bySource.patient_assistant ?? 0) / live.length : null,
    },
    by_day: days,
    by_source: bySource,
    heatmap: [...heat].map(([key, visits]) => {
      const [weekday, hour] = key.split('-').map(Number);
      return { weekday, hour, visits };
    }),
    top_services: [...services.values()].sort((a, b) => b.visits - a.visits).slice(0, 6),
    by_doctor: [...doctors.values()].sort((a, b) => b.visits - a.visits),
    ai_outcomes: outcomes,
  };
}

async function period(admin, from, to) {
  const range = { from: startOfDayInZone(from).toISOString(), to: startOfDayInZone(addDays(to, 1)).toISOString() };
  const [appointments, runs, newPatients, escalations] = await Promise.all([
    statsModel.appointmentsStarting(admin, range),
    statsModel.runOutcomes(admin, range),
    statsModel.countCreated(admin, 'patients', range),
    statsModel.countCreated(admin, 'escalations', range),
  ]);
  return summarize({ appointments, runs, newPatients, escalations, from, to });
}

/** The chosen period, plus the totals of the period of the same length just before it (for the ↑↓ arrows). */
export async function rangeStats(_ctx, { from, to }) {
  const admin = requireAdmin();
  const length = Math.round((new Date(to) - new Date(from)) / 86_400_000) + 1;
  const previousFrom = addDays(from, -length);
  const previousTo = addDays(from, -1);
  const [current, previous] = await Promise.all([period(admin, from, to), period(admin, previousFrom, previousTo)]);
  return { from, to, previous_from: previousFrom, previous_to: previousTo, ...current, previous: previous.totals };
}

// ----- what the assistant did (G3) -----

/** Bookings, changes, handovers and failures, newest first, with the tools it used. */
export async function assistantActivity({ user, db }, page) {
  const result = await agentRunModel.listActions(requireAdmin(), page);
  const conversations = await Promise.all(
    [...new Set(result.rows.map((r) => r.conversation_id).filter(Boolean))].map((id) => conversationModel.findById(requireAdmin(), id)),
  );
  const byId = new Map(conversations.filter(Boolean).map((c) => [c.id, c]));
  const patients = await patientModel.namesByIds(db, conversations.filter(Boolean).map((c) => c.patient_id));
  const viewer = user.role === 'viewer';
  return listView(result, page, (run) => {
    const conversation = byId.get(run.conversation_id);
    return {
      id: run.id,
      conversation_id: run.conversation_id,
      outcome: run.outcome,
      latency_ms: run.latency_ms,
      created_at: run.created_at,
      tools: (run.tool_calls ?? []).filter((t) => t?.name && !t.name.startsWith('_')).map((t) => ({ name: t.name, ok: t.ok !== false })),
      conversation_title: viewer ? null : (conversation?.title ?? null),
      patient_name: patients.get(conversation?.patient_id) ?? null,
    };
  });
}
