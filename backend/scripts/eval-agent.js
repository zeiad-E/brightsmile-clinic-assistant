/**
 * Agent evals: scripted conversations against the LIVE assistant (real AI, real database),
 * scored automatically, with every test record removed afterwards.
 *
 *   npm run eval:agent                     all cases
 *   npm run eval:agent -- --only booking   one category, group or case id
 *   npm run eval:agent -- --concurrency 2  conversations in flight at once (default 3)
 *   npm run eval:agent -- --keep           leave the test records (for debugging)
 *   npm run eval:agent -- --min 0.9        exit with an error below this pass rate
 *
 * Needs in backend/.env: EVAL_KEY (the same value as on Render), SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY (to read back what happened and clean up); EVAL_API_URL optional.
 *
 * Test patients use "@eval.invalid" emails: that domain can never exist, and the server never
 * emails it. A JSON report is written to evals/results/.
 */
import fs from 'node:fs';
import { config } from '../src/config/index.js';
import { supabaseAdmin as admin } from '../src/db/supabase.js';
import { addDays, dayInZone, weekdayName } from '../src/utils/clinicTime.js';
import { CASES } from '../evals/cases.js';
import { score, westernDigits } from '../evals/checks.js';

const API = (process.env.EVAL_API_URL || 'https://brightsmile-api-3si7.onrender.com').replace(/\/$/, '');
const RUN = Date.now().toString(36);
const STARTED = new Date();
const EVAL_DOMAIN = 'eval.invalid';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? true);
};
const ONLY = option('only', null);
const CONCURRENCY = Number(option('concurrency', 3));
const KEEP = args.includes('--keep');
const MIN = option('min', null) === null ? null : Number(option('min'));

if (!config.evalKey) throw new Error('Set EVAL_KEY in backend/.env (the same value as on Render).');
if (!admin) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env.');

// ---------- the scenario: dates and eval patients ----------

const WEEKDAYS_AR = { Sunday: 'الأحد', Monday: 'الاثنين', Tuesday: 'الثلاثاء', Wednesday: 'الأربعاء', Thursday: 'الخميس' };

/** A Sunday–Thursday at least 4 days ahead (every doctor works then; far outside the 24 h window). */
function bookingDay() {
  let day = addDays(dayInZone(), 4);
  while (!WEEKDAYS_AR[weekdayName(day)]) day = addDays(day, 1);
  return { date: day, weekday: weekdayName(day), weekdayAr: WEEKDAYS_AR[weekdayName(day)] };
}

const day = bookingDay();
const scenario = {
  day,
  later: { from: addDays(day.date, 2), to: addDays(day.date, 9) },
  email: (name) => `eval-${RUN}-${name}@${EVAL_DOMAIN}`,
};
const sessions = new Map(); // eval patient → access token (from their booking)

// ---------- talking to the live API ----------

async function send(c, message, { conversationId, token }) {
  const headers = { 'Content-Type': 'application/json', 'x-eval-key': config.evalKey, 'x-eval-case': `${RUN}-${c.id}`.slice(0, 64) };
  if (token) headers.Authorization = `Bearer ${token}`;
  for (let attempt = 1; ; attempt += 1) {
    const started = Date.now();
    const res = await fetch(`${API}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message, conversation_id: conversationId ?? undefined }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ...body, ms: Date.now() - started };
    // Busy (queue full) or rate limited: wait and try again, a few times.
    if ([429, 503].includes(res.status) && attempt < 4) {
      await new Promise((r) => setTimeout(r, (body.details?.retry_after_seconds ?? 15) * 1000));
      continue;
    }
    throw new Error(`API ${res.status}: ${body.error ?? ''} ${body.message ?? ''}`.trim());
  }
}

// ---------- reading back what happened ----------

async function patientRecords(name) {
  const { data: patient } = await admin.from('patients').select('id').eq('email', scenario.email(name)).maybeSingle();
  if (!patient) return { id: null, appointments: [], memories: [], waitlist: [] };
  const [appointments, memories, waitlist] = await Promise.all([
    admin.from('appointments').select('id, status, starts_at').eq('patient_id', patient.id),
    admin.from('patient_memories').select('id, content').eq('patient_id', patient.id),
    admin.from('waitlist').select('id, status').eq('patient_id', patient.id),
  ]);
  return { id: patient.id, appointments: appointments.data ?? [], memories: memories.data ?? [], waitlist: waitlist.data ?? [] };
}

async function evidence(c, { conversationIds, replies, results }) {
  const [tools, runs, conversations, escalations] = await Promise.all([
    admin.from('messages').select('tool_name, tool_payload, id').in('conversation_id', conversationIds).eq('role', 'tool').order('id'),
    admin.from('agent_runs').select('outcome, latency_ms, tokens_in, tokens_out, model, retries').in('conversation_id', conversationIds),
    admin.from('conversations').select('id, status').in('id', conversationIds),
    admin.from('escalations').select('id', { count: 'exact', head: true }).in('conversation_id', conversationIds),
  ]);
  return {
    replies,
    results,
    tools: (tools.data ?? []).map((t) => ({ name: t.tool_name, ok: !t.tool_payload?.result?.error })),
    runs: runs.data ?? [],
    conversations: conversationIds.map((id) => (conversations.data ?? []).find((row) => row.id === id)).filter(Boolean),
    escalations: escalations.count ?? 0,
    patient: c.patient ? await patientRecords(c.patient) : null,
    allowedPrices,
  };
}

/** Is the goal of a nudge reached (the booking made / cancelled)? */
async function reached(c, goal) {
  const { appointments } = await patientRecords(c.patient);
  return appointments.some((a) => a.status === goal);
}

// ---------- one case ----------

async function runCase(c) {
  const started = Date.now();
  const replies = [];
  const results = [];
  let conversationId = null;
  let sessionFromCase = null; // a booking signs a new patient in: later turns use that session
  const token = c.as ? sessions.get(c.as) : null;
  if (c.as && !token) return { case: c, skipped: `no session for ${c.as} (their booking failed)` };

  const say = async (message) => {
    const res = await send(c, message, { conversationId, token: token ?? sessionFromCase });
    conversationId = res.conversation_id;
    replies.push(res.reply);
    results.push(res);
    if (res.session?.access_token && c.patient) {
      sessions.set(c.patient, res.session.access_token);
      sessionFromCase = res.session.access_token;
    }
  };

  try {
    for (const turn of c.turns) await say(typeof turn === 'function' ? turn(scenario) : turn);
    if (c.nudge) {
      for (let i = 0; i < c.nudge.max && !(await reached(c, c.nudge.until)); i += 1) await say(c.nudge.text);
    }
  } catch (err) {
    return { case: c, error: err.message, conversationIds: conversationId ? [conversationId] : [], replies };
  }

  const ev = await evidence(c, { conversationIds: [conversationId], replies, results });
  const checks = score(ev, c.expect);
  return {
    case: c,
    conversationIds: [conversationId],
    replies,
    checks,
    pass: checks.every((k) => k.pass),
    ms: Date.now() - started,
    turns: replies.length,
    tokens: ev.runs.reduce((sum, r) => sum + (r.tokens_in ?? 0) + (r.tokens_out ?? 0), 0),
    retries: ev.runs.reduce((sum, r) => sum + (r.retries ?? 0), 0),
  };
}

// ---------- prices the assistant may mention ----------

let allowedPrices = new Set();
async function loadAllowedPrices() {
  const services = await fetch(`${API}/api/services`).then((r) => r.json());
  const prices = new Set((services.data ?? services).map((s) => Number(s.price_egp)));
  const { data: docs } = await admin.from('knowledge_docs').select('content');
  for (const doc of docs ?? []) {
    const text = westernDigits(doc.content).replace(/(\d),(\d{3})/g, '$1$2');
    for (const m of text.matchAll(/(\d{2,6})\s*(?:EGP|LE|جنيه|ج\.?م)|(?:EGP|جنيه)\s*(\d{2,6})/gi)) prices.add(Number(m[1] ?? m[2]));
  }
  allowedPrices = prices;
}

// ---------- clean-up: every record this run created ----------

async function cleanup(conversationIds) {
  const { data: patients } = await admin.from('patients').select('id, profile_id').like('email', `%@${EVAL_DOMAIN}`);
  const patientIds = (patients ?? []).map((p) => p.id);
  const logins = (patients ?? []).map((p) => p.profile_id).filter(Boolean);

  const ids = new Set(conversationIds.filter(Boolean));
  if (patientIds.length) {
    const { data } = await admin.from('conversations').select('id').in('patient_id', patientIds);
    for (const row of data ?? []) ids.add(row.id);
  }
  const convIds = [...ids];

  if (convIds.length) {
    await admin.from('agent_runs').delete().in('conversation_id', convIds);
    await admin.from('escalations').delete().in('conversation_id', convIds);
    const { data: gaps } = await admin.from('knowledge_gaps').select('id, count').in('last_conversation_id', convIds);
    for (const gap of gaps ?? []) {
      if (gap.count <= 1) await admin.from('knowledge_gaps').delete().eq('id', gap.id);
      else await admin.from('knowledge_gaps').update({ count: gap.count - 1 }).eq('id', gap.id);
    }
    await admin.from('jobs').delete().eq('status', 'queued').in('payload->>conversationId', convIds);
  }

  if (patientIds.length) {
    const { data: appts } = await admin.from('appointments').select('id').in('patient_id', patientIds);
    const apptIds = (appts ?? []).map((a) => a.id);
    if (apptIds.length) {
      await admin.from('notifications').delete().in('appointment_id', apptIds);
      await admin.from('audit_log').delete().eq('entity', 'appointments').in('entity_id', apptIds);
      await admin.from('appointments').delete().in('id', apptIds);
    }
    const { data: notes } = await admin.from('patient_memories').select('id').in('patient_id', patientIds);
    const noteIds = (notes ?? []).map((n) => n.id);
    if (noteIds.length) await admin.from('audit_log').delete().eq('entity', 'patient_memories').in('entity_id', noteIds);
    await admin.from('notifications').delete().in('patient_id', patientIds);
    await admin.from('escalations').delete().in('patient_id', patientIds);
    await admin.from('jobs').delete().eq('status', 'queued').in('payload->>patientId', patientIds);
    await admin.from('audit_log').delete().eq('entity', 'patients').in('entity_id', patientIds);
    await admin.from('patients').delete().in('id', patientIds);
  }

  if (convIds.length) await admin.from('conversations').delete().in('id', convIds); // messages go with them

  for (const id of logins) {
    await admin.from('audit_log').delete().eq('actor_id', id);
    await admin.auth.admin.deleteUser(id);
  }
  return { conversations: convIds.length, patients: patientIds.length, logins: logins.length };
}

// ---------- running and reporting ----------

function units(cases) {
  const groups = new Map();
  const singles = [];
  for (const c of cases) {
    if (c.group) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
    else singles.push([c]);
  }
  return [...groups.values(), ...singles]; // groups first: they take longest
}

async function runAll(cases) {
  const queue = units(cases);
  const outcomes = [];
  const worker = async () => {
    for (let unit = queue.shift(); unit; unit = queue.shift()) {
      for (const c of unit) {
        const outcome = await runCase(c);
        outcomes.push(outcome);
        printLine(outcome);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return outcomes;
}

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '–');

function printLine(o) {
  const c = o.case;
  if (o.skipped || o.error) {
    console.log(`  ✗ ${c.id.padEnd(28)} ${o.skipped ? `skipped: ${o.skipped}` : `error: ${o.error}`}`);
    return;
  }
  console.log(`  ${o.pass ? '✓' : '✗'} ${c.id.padEnd(28)} ${String(o.turns).padStart(2)} turn(s) ${(o.ms / 1000).toFixed(1).padStart(5)} s`);
  for (const k of o.checks.filter((check) => !check.pass)) console.log(`      ✗ ${k.name}: ${k.detail}`);
}

function summarize(outcomes) {
  const by = (key) => {
    const rows = new Map();
    for (const o of outcomes) {
      const k = o.case[key];
      const row = rows.get(k) ?? { pass: 0, total: 0 };
      row.total += 1;
      if (o.pass) row.pass += 1;
      rows.set(k, row);
    }
    return [...rows.entries()].map(([k, r]) => `  ${String(k).padEnd(14)} ${r.pass}/${r.total}  ${pct(r.pass, r.total)}`).join('\n');
  };
  const done = outcomes.filter((o) => o.checks);
  const passed = outcomes.filter((o) => o.pass).length;
  const checks = done.flatMap((o) => o.checks);
  const turns = done.reduce((s, o) => s + o.turns, 0);
  const tokens = done.reduce((s, o) => s + o.tokens, 0);
  const ms = done.reduce((s, o) => s + o.ms, 0);

  console.log('\nBy category\n' + by('category'));
  console.log('\nBy language\n' + by('language'));
  console.log(`\nCases   ${passed}/${outcomes.length} passed (${pct(passed, outcomes.length)})`);
  console.log(`Checks  ${checks.filter((k) => k.pass).length}/${checks.length} passed`);
  console.log(`Turns   ${turns}, average ${(ms / Math.max(turns, 1) / 1000).toFixed(1)} s per reply`);
  console.log(`Tokens  ${tokens.toLocaleString('en')} (about ${Math.round(tokens / Math.max(turns, 1)).toLocaleString('en')} per turn)`);
  console.log(`Retries ${done.reduce((s, o) => s + o.retries, 0)}`);
  return { passed, total: outcomes.length, rate: outcomes.length ? passed / outcomes.length : 0, turns, tokens };
}

function selected() {
  if (!ONLY) return CASES;
  const chosen = CASES.filter((c) => [c.id, c.category, c.group, c.language].includes(ONLY));
  // A signed-in case needs its group's booking first.
  const needed = new Set(chosen.filter((c) => c.as).map((c) => c.as));
  return CASES.filter((c) => chosen.includes(c) || (needed.has(c.group) && !c.as));
}

async function main() {
  const cases = selected();
  console.log(`Agent evals · run ${RUN} · ${cases.length} case(s) against ${API}`);
  console.log(`Booking day: ${day.weekday} ${day.date}\n`);
  await loadAllowedPrices();

  let outcomes = [];
  try {
    outcomes = await runAll(cases);
  } finally {
    const report = outcomes.length ? summarize(outcomes) : null;
    const conversationIds = outcomes.flatMap((o) => o.conversationIds ?? []);
    if (report) {
      fs.mkdirSync(new URL('../evals/results/', import.meta.url), { recursive: true });
      const file = new URL(`../evals/results/${STARTED.toISOString().slice(0, 10)}-${RUN}.json`, import.meta.url);
      const rows = outcomes.map((o) => ({ id: o.case.id, category: o.case.category, language: o.case.language, pass: o.pass ?? false, error: o.error ?? o.skipped, checks: o.checks, replies: o.replies, ms: o.ms, tokens: o.tokens }));
      fs.writeFileSync(file, JSON.stringify({ run: RUN, api: API, startedAt: STARTED, summary: report, cases: rows }, null, 2));
      console.log(`Report  ${file.pathname.replace(/^\/([A-Z]:)/, '$1')}`);
    }
    if (KEEP) console.log('\nTest records kept (--keep).');
    else console.log(`\nCleaned up: ${JSON.stringify(await cleanup(conversationIds))}`);
    if (report && MIN !== null && report.rate < MIN) process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
