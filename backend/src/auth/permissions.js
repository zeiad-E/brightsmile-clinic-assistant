/**
 * Who may do what, in one place.
 *
 * A route asks for a named permission (`requirePermission('patients.write')`), never for a role.
 * Each role is a list of permissions, so what a role can do is readable here at a glance, and
 * changing it means changing one list.
 *
 *  - patient: their own profile, bookings, chats and code.
 *  - viewer:  a read-only demo account; sees the dashboards with personal data masked.
 *  - staff:   runs the day (appointments, patients, escalations, time off).
 *  - owner:   everything staff can do, plus prices, doctors, hours, settings and the team.
 */
const SELF = ['self.profile', 'self.appointments', 'self.conversations', 'self.memory', 'self.contact', 'self.personal_code'];

// Everyone on the team can look at the day's work.
const TEAM_READ = [
  'account.profile.read',
  'appointments.read',
  'patients.read',
  'escalations.read',
  'time_off.read',
  'conversations.read',
  'stats.read',
];

// The people who actually run the clinic: unmasked data, and changes.
const DESK = [
  'pii.read',
  'account.profile.update',
  'account.password.change',
  'appointments.write',
  'patients.write',
  'patients.login.manage',
  'patients.code.view',
  'patients.code.regenerate',
  'escalations.resolve',
  'time_off.write',
  'conversations.respond',
  'assistant_reports.create',
];

// The owner's pages, which the viewer may look at.
const OWNER_READ = ['catalog.read_all', 'settings.read', 'team.read', 'reports.read', 'knowledge.read', 'intake.read'];

const OWNER_WRITE = [
  'catalog.manage',
  'settings.write',
  'team.manage',
  'assistant_reports.resolve',
  'knowledge.write',
  'intake.write',
  'agent_memory.manage',
  'conversations.delete',
];

const ROLE_PERMISSIONS = Object.freeze({
  patient: new Set(SELF),
  viewer: new Set([...TEAM_READ, ...OWNER_READ]),
  staff: new Set([...TEAM_READ, ...DESK]),
  owner: new Set([...TEAM_READ, ...DESK, ...OWNER_READ, ...OWNER_WRITE]),
});

export const ALL_PERMISSIONS = Object.freeze([...new Set(Object.values(ROLE_PERMISSIONS).flatMap((set) => [...set]))]);

/** May this user do this? A visitor, or a role we don't know, may do nothing. */
export const can = (user, permission) => ROLE_PERMISSIONS[user?.role]?.has(permission) ?? false;

/** The list the frontend uses to show or hide buttons. The real check is always on the server. */
export const permissionsOf = (role) => [...(ROLE_PERMISSIONS[role] ?? [])];
