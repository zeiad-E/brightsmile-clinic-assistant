import { requireAdmin } from '../db/supabase.js';
import * as memoryModel from '../models/memoryModel.js';
import * as appointmentService from '../services/appointmentService.js';
import * as catalogService from '../services/catalogService.js';
import * as intakeService from '../services/intakeService.js';
import { dayInZone, timeInZone, weekdayName } from '../utils/clinicTime.js';
import { logger } from '../utils/logger.js';

/**
 * Builds the facts the assistant needs this turn — from the database and the verified login,
 * kept small so every turn costs about the same number of tokens.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function describeHours(openingHours) {
  const open = new Map(openingHours.map((h) => [h.weekday, `${h.opens}–${h.closes}`]));
  const parts = [];
  for (let day = 0; day < 7; day += 1) parts.push(`${WEEKDAYS[day]} ${open.get(day) ?? 'closed'}`);
  return parts.join(', ');
}

function describePending(pending) {
  if (!pending) return null;
  const s = pending.summary ?? {};
  if (pending.type === 'book') return `booking ${s.service} with ${s.doctor} on ${s.weekday} ${s.date} at ${s.time} (${s.price_egp} EGP)`;
  if (pending.type === 'cancel') return `cancelling ${s.service} on ${s.weekday} ${s.date} at ${s.time}`;
  if (pending.type === 'reschedule') return `moving ${s.service} to ${s.to?.weekday} ${s.to?.date} at ${s.to?.time}`;
  return pending.type;
}

export async function buildContext({ conversation, state, user, db, settings, language = 'en' }) {
  const timeZone = settings.timezone;
  const now = new Date();
  const today = dayInZone(now, timeZone);
  const clinic = await catalogService.clinicInfo(db);

  let patient = null;
  if (user?.role === 'patient' && user.patientId) {
    const [memories, upcoming, missingIntake] = await Promise.all([
      memoryModel.listForPatient(requireAdmin(), user.patientId).catch((err) => {
        logger.warn(`Memories not loaded: ${err.message}`);
        return [];
      }),
      appointmentService.listMine({ user, db }, { scope: 'upcoming', limit: 3, offset: 0 }).catch(() => ({ data: [] })),
      intakeService.missingFor(user.patientId).catch(() => []),
    ]);
    patient = {
      fullName: user.fullName,
      preferredLanguage: user.preferredLanguage,
      // Owner corrections first: they always win.
      memories: [...memories].sort((a, b) => (a.source === 'owner' ? -1 : 0) - (b.source === 'owner' ? -1 : 0)).map((m) => (m.source === 'owner' ? `[from the clinic] ${m.content}` : m.content)),
      missingIntake: missingIntake.map((f) =>
        f.kind === 'choice' ? `${f.key} ("${f.label_en}"; options: ${f.options.map((o) => o.label_en).join(' / ')})` : `${f.key} ("${f.label_en}")`,
      ),
      upcoming: upcoming.data.map((a) => {
        const day = dayInZone(new Date(a.starts_at), timeZone);
        return `${a.service.name_en} with ${a.doctor.full_name_en} on ${weekdayName(day)} ${day} ${timeInZone(a.starts_at, timeZone)}`;
      }),
    };
  }

  return {
    replyLanguage: language,
    clinicName: settings.name_en,
    clinicPhone: settings.phone,
    timeZone,
    today: { date: today, weekday: weekdayName(today), time: timeInZone(now, timeZone) },
    openingHours: describeHours(clinic.opening_hours),
    patient,
    pending: describePending(state.pending),
    summary: conversation.summary ?? null,
    handedOff: conversation.status === 'handed_off',
  };
}
