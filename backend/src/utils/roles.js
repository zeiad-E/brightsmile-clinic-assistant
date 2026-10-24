/**
 * Who may do what, in one place. Routes use these groups with requireRole().
 *
 * - viewer: a read-only demo account; sees every dashboard (masked), never writes.
 * - staff:  runs the day (appointments, patients, escalations, time off).
 * - owner:  everything staff can do + prices, doctors, hours, settings, team.
 */
export const ROLES = Object.freeze({
  PATIENT: ['patient'],
  STAFF_READ: ['staff', 'owner', 'viewer'],
  STAFF_WRITE: ['staff', 'owner'],
  ADMIN_READ: ['owner', 'viewer'],
  OWNER: ['owner'],
  TEAM: ['staff', 'owner', 'viewer'],
});
