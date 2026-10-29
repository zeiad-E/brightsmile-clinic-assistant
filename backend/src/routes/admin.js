import { Router } from 'express';
import * as services from '../controllers/admin/adminServiceController.js';
import * as doctors from '../controllers/admin/adminStaffController.js';
import * as settings from '../controllers/admin/clinicSettingsController.js';
import * as team from '../controllers/admin/teamController.js';
import * as audit from '../controllers/admin/auditController.js';
import * as notifications from '../controllers/admin/notificationController.js';
import * as memories from '../controllers/admin/agentMemoryController.js';
import * as intake from '../controllers/admin/intakeController.js';
import * as agentStatus from '../controllers/admin/agentStatusController.js';
import * as knowledge from '../controllers/admin/knowledgeController.js';
import * as stats from '../controllers/staff/statsController.js';
import * as reports from '../controllers/staff/assistantReportController.js';
import { fileUpload } from '../middlewares/fileUpload.js';
import { validate } from '../middlewares/validate.js';
import { requireRole } from '../middlewares/requireRole.js';
import { ROLES } from '../utils/roles.js';
import { IdParams } from '../validators/common.js';
import {
  ActivityQuery,
  AuditQuery,
  DoctorBody,
  DoctorPatch,
  GapPatch,
  GapQuery,
  IntakeFieldBody,
  IntakeFieldPatch,
  KnowledgeBody,
  KnowledgePatch,
  KnowledgeQuery,
  KnowledgeUploadFields,
  MemoryBody,
  MemoryPatch,
  MemoryQuery,
  NotificationQuery,
  RangeStatsQuery,
  ReportQuery,
  ReportResolveBody,
  RoleBody,
  ServiceBody,
  ServicePatch,
  SettingsPatch,
  StaffServicesBody,
  TeamCreateBody,
  TeamMemberPatch,
  WorkingHoursBody,
} from '../validators/admin.js';

/**
 * /api/admin — the owner's settings.
 * Reads: owner and viewer (masked). Writes: owner only. Staff get 403.
 */
export function adminRouter() {
  const router = Router();
  const read = requireRole(ROLES.ADMIN_READ);
  const write = requireRole(ROLES.OWNER);
  const id = validate({ params: IdParams });

  router.get('/services', read, services.list);
  router.post('/services', write, validate({ body: ServiceBody }), services.create);
  router.patch('/services/:id', write, validate({ params: IdParams, body: ServicePatch }), services.update);
  router.delete('/services/:id', write, id, services.deactivate);

  router.get('/doctors', read, doctors.list);
  router.post('/doctors', write, validate({ body: DoctorBody }), doctors.create);
  router.patch('/doctors/:id', write, validate({ params: IdParams, body: DoctorPatch }), doctors.update);
  router.delete('/doctors/:id', write, id, doctors.deactivate);
  router.put('/doctors/:id/services', write, validate({ params: IdParams, body: StaffServicesBody }), doctors.setServices);
  router.put('/doctors/:id/working-hours', write, validate({ params: IdParams, body: WorkingHoursBody }), doctors.setWorkingHours);

  router.get('/settings', read, settings.get);
  router.patch('/settings', write, validate({ body: SettingsPatch }), settings.update);

  router.get('/team', read, team.list);
  router.post('/team', write, validate({ body: TeamCreateBody }), team.create);
  router.patch('/team/:id', write, validate({ params: IdParams, body: TeamMemberPatch }), team.update);
  router.patch('/team/:id/role', write, validate({ params: IdParams, body: RoleBody }), team.setRole);
  router.post('/team/:id/resend-invite', write, id, team.resendInvite);
  router.post('/team/:id/disable', write, id, team.disable);
  router.post('/team/:id/enable', write, id, team.enable);

  router.get('/audit-log', read, validate({ query: AuditQuery }), audit.list);
  router.get('/notifications', read, validate({ query: NotificationQuery }), notifications.list);

  router.get('/agent/status', read, agentStatus.status);
  router.get('/agent/activity', read, validate({ query: ActivityQuery }), stats.activity);
  router.get('/agent/reports', read, validate({ query: ReportQuery }), reports.list);
  router.post('/agent/reports/:id/resolve', write, validate({ params: IdParams, body: ReportResolveBody }), reports.resolve);

  // The owner's overview for any period (G9).
  router.get('/stats', read, validate({ query: RangeStatsQuery }), stats.range);

  // Knowledge base: the upload route is declared before '/:id' so "upload" isn't read as an id.
  router.get('/knowledge', read, validate({ query: KnowledgeQuery }), knowledge.list);
  router.post('/knowledge', write, validate({ body: KnowledgeBody }), knowledge.create);
  router.post('/knowledge/upload', write, fileUpload(), validate({ body: KnowledgeUploadFields }), knowledge.upload);
  router.get('/knowledge/:id', read, id, knowledge.get);
  router.patch('/knowledge/:id', write, validate({ params: IdParams, body: KnowledgePatch }), knowledge.update);
  router.delete('/knowledge/:id', write, id, knowledge.remove);
  router.post('/knowledge/:id/reingest', write, id, knowledge.reingest);

  router.get('/knowledge-gaps', read, validate({ query: GapQuery }), knowledge.gaps);
  router.patch('/knowledge-gaps/:id', write, validate({ params: IdParams, body: GapPatch }), knowledge.setGapStatus);

  // The agent's memory notes: owner only (not even the viewer).
  router.get('/agent/memories', write, validate({ query: MemoryQuery }), memories.list);
  router.post('/agent/memories', write, validate({ body: MemoryBody }), memories.create);
  router.patch('/agent/memories/:id', write, validate({ params: IdParams, body: MemoryPatch }), memories.update);
  router.delete('/agent/memories/:id', write, id, memories.remove);

  router.get('/intake-fields', read, intake.list);
  router.post('/intake-fields', write, validate({ body: IntakeFieldBody }), intake.create);
  router.patch('/intake-fields/:id', write, validate({ params: IdParams, body: IntakeFieldPatch }), intake.update);
  router.delete('/intake-fields/:id', write, id, intake.remove);

  return router;
}
