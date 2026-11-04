import { beforeEach, describe, expect, it, vi } from 'vitest';
import { viewName } from '../../src/models/query.js';
import * as appointmentModel from '../../src/models/appointmentModel.js';
import * as auditModel from '../../src/models/auditModel.js';
import * as conversationModel from '../../src/models/conversationModel.js';
import * as messageModel from '../../src/models/messageModel.js';
import * as notificationModel from '../../src/models/notificationModel.js';
import * as patientModel from '../../src/models/patientModel.js';
import * as profileModel from '../../src/models/profileModel.js';

/**
 * The database no longer knows who is asking, so hiding personal data from the read-only viewer
 * is the backend's job. These tests record which view each kind of caller really reads.
 */
function fakeDb(piiAccess) {
  const read = [];
  const filters = [];
  const query = {
    select: () => query,
    order: () => query,
    range: () => query,
    in: () => query,
    or: () => query,
    gte: () => query,
    lt: () => query,
    eq: (column, value) => {
      filters.push([column, value]);
      return query;
    },
    maybeSingle: () => query,
    then: (resolve) => resolve({ data: [], error: null, count: 0 }),
  };
  return { piiAccess, read, filters, from: (name) => (read.push(name), query) };
}

const READS = [
  ['patient search', (db) => patientModel.search(db, {}), 'v_patients'],
  ['patient page', (db) => patientModel.findInView(db, 'p1'), 'v_patients'],
  ['patient names', (db) => patientModel.namesByIds(db, ['p1']), 'v_patients'],
  ['team list', (db) => profileModel.listTeam(db), 'v_profiles'],
  ['staff names', (db) => profileModel.namesByIds(db, ['u1'], { masked: true }), 'v_profiles'],
  ['appointment list', (db) => appointmentModel.listForStaff(db, {}), 'v_appointments'],
  ['appointment page', (db) => appointmentModel.findForStaff(db, 'a1'), 'v_appointments'],
  ['chat messages', (db) => messageModel.listForStaff(db, 'c1'), 'v_messages'],
  ['notifications', (db) => notificationModel.list(db, {}), 'v_notifications'],
  ['audit log', (db) => auditModel.list(db, {}), 'v_audit_log'],
];

describe('which data a caller gets', () => {
  it.each(READS)('%s: staff and owner read the plain view', async (_name, read, view) => {
    const db = fakeDb(true);
    await read(db);
    expect(db.read).toEqual([view]);
  });

  it.each(READS)('%s: the viewer reads the masked view', async (_name, read, view) => {
    const db = fakeDb(false);
    await read(db);
    expect(db.read).toEqual([`${view}_masked`]);
  });

  it.each(READS)('%s: a client nobody marked gets masked data too', async (_name, read, view) => {
    const db = fakeDb(undefined);
    await read(db);
    expect(db.read).toEqual([`${view}_masked`]);
  });

  it('only an explicit true opens the plain view', () => {
    expect(viewName({ piiAccess: true }, 'v_patients')).toBe('v_patients');
    expect(viewName({ piiAccess: 'yes' }, 'v_patients')).toBe('v_patients_masked');
    expect(viewName(null, 'v_patients')).toBe('v_patients_masked');
  });
});

describe('a patient’s own chats', () => {
  it('are filtered by their login in code, not left to the database', async () => {
    const db = fakeDb(false);
    await conversationModel.listMine(db, 'profile-1', { limit: 10, offset: 0 });
    expect(db.filters).toContainEqual(['profile_id', 'profile-1']);
  });
});

describe('the chat tools’ view of a booking', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('treats someone else’s booking as unknown', async () => {
    vi.spyOn(appointmentModel, 'findById').mockResolvedValue({ id: 'a1', patient_id: 'other', status: 'booked', starts_at: '2026-12-01T08:00:00Z' });
    const { proposeCancel } = await import('../../src/agent/tools/bookingTools.js');
    const ctx = { state: { refs: { A1: '11111111-1111-4111-8111-111111111111' } }, db: {}, user: { patientId: 'mine' }, timeZone: 'Africa/Cairo', turnNumber: 1 };

    expect(await proposeCancel.run({ appointment: 'A1' }, ctx)).toMatchObject({ error: 'unknown_appointment' });
    expect(ctx.state.pending).toBeUndefined();
  });
});
