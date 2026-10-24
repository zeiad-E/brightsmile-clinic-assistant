import * as auditModel from '../models/auditModel.js';
import * as notificationModel from '../models/notificationModel.js';
import * as statsModel from '../models/statsModel.js';
import { listView } from '../views/listView.js';

/** Read-only dashboards: today's numbers, the audit log, sent emails. */

export function statsToday({ db }) {
  return statsModel.today(db);
}

export function upcomingByDoctor({ db }) {
  return statsModel.upcomingByDoctor(db);
}

export async function auditLog({ db }, filters) {
  return listView(await auditModel.list(db, filters), filters);
}

export async function notifications({ db }, filters) {
  return listView(await notificationModel.list(db, filters), filters);
}
