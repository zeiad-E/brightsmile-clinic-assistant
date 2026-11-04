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
import { requirePermission } from '../middlewares/requirePermission.js';
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
  const id = validate({ params: IdParams });

  router.get('/services', requirePermission('catalog.read_all'), services.list);
  router.post('/services', requirePermission('catalog.manage'), validate({ body: ServiceBody }), services.create);
  router.patch('/services/:id', requirePermission('catalog.manage'), validate({ params: IdParams, body: ServicePatch }), services.update);
  router.delete('/services/:id', requirePermission('catalog.manage'), id, services.deactivate);

  router.get('/doctors', requirePermission('catalog.read_all'), doctors.list);
  router.post('/doctors', requirePermission('catalog.manage'), validate({ body: DoctorBody }), doctors.create);
  router.patch('/doctors/:id', requirePermission('catalog.manage'), validate({ params: IdParams, body: DoctorPatch }), doctors.update);
  router.delete('/doctors/:id', requirePermission('catalog.manage'), id, doctors.deactivate);
  router.put('/doctors/:id/services', requirePermission('catalog.manage'), validate({ params: IdParams, body: StaffServicesBody }), doctors.setServices);
  router.put('/doctors/:id/working-hours', requirePermission('catalog.manage'), validate({ params: IdParams, body: WorkingHoursBody }), doctors.setWorkingHours);

  router.get('/settings', requirePermission('settings.read'), settings.get);
  router.patch('/settings', requirePermission('settings.write'), validate({ body: SettingsPatch }), settings.update);

  router.get('/team', requirePermission('team.read'), team.list);
  router.post('/team', requirePermission('team.manage'), validate({ body: TeamCreateBody }), team.create);
  router.patch('/team/:id', requirePermission('team.manage'), validate({ params: IdParams, body: TeamMemberPatch }), team.update);
  router.patch('/team/:id/role', requirePermission('team.manage'), validate({ params: IdParams, body: RoleBody }), team.setRole);
  router.post('/team/:id/resend-invite', requirePermission('team.manage'), id, team.resendInvite);
  router.post('/team/:id/disable', requirePermission('team.manage'), id, team.disable);
  router.post('/team/:id/enable', requirePermission('team.manage'), id, team.enable);

  router.get('/audit-log', requirePermission('reports.read'), validate({ query: AuditQuery }), audit.list);
  router.get('/notifications', requirePermission('reports.read'), validate({ query: NotificationQuery }), notifications.list);

  router.get('/agent/status', requirePermission('reports.read'), agentStatus.status);
  router.get('/agent/activity', requirePermission('reports.read'), validate({ query: ActivityQuery }), stats.activity);
  router.get('/agent/reports', requirePermission('reports.read'), validate({ query: ReportQuery }), reports.list);
  router.post('/agent/reports/:id/resolve', requirePermission('assistant_reports.resolve'), validate({ params: IdParams, body: ReportResolveBody }), reports.resolve);

  // The owner's overview for any period (G9).
  router.get('/stats', requirePermission('reports.read'), validate({ query: RangeStatsQuery }), stats.range);

  // Knowledge base: the upload route is declared before '/:id' so "upload" isn't read as an id.
  router.get('/knowledge', requirePermission('knowledge.read'), validate({ query: KnowledgeQuery }), knowledge.list);
  router.post('/knowledge', requirePermission('knowledge.write'), validate({ body: KnowledgeBody }), knowledge.create);
  router.post('/knowledge/upload', requirePermission('knowledge.write'), fileUpload(), validate({ body: KnowledgeUploadFields }), knowledge.upload);
  router.get('/knowledge/:id', requirePermission('knowledge.read'), id, knowledge.get);
  router.patch('/knowledge/:id', requirePermission('knowledge.write'), validate({ params: IdParams, body: KnowledgePatch }), knowledge.update);
  router.delete('/knowledge/:id', requirePermission('knowledge.write'), id, knowledge.remove);
  router.post('/knowledge/:id/reingest', requirePermission('knowledge.write'), id, knowledge.reingest);

  router.get('/knowledge-gaps', requirePermission('knowledge.read'), validate({ query: GapQuery }), knowledge.gaps);
  router.patch('/knowledge-gaps/:id', requirePermission('knowledge.write'), validate({ params: IdParams, body: GapPatch }), knowledge.setGapStatus);

  // The agent's memory notes: owner only (not even the viewer).
  router.get('/agent/memories', requirePermission('agent_memory.manage'), validate({ query: MemoryQuery }), memories.list);
  router.post('/agent/memories', requirePermission('agent_memory.manage'), validate({ body: MemoryBody }), memories.create);
  router.patch('/agent/memories/:id', requirePermission('agent_memory.manage'), validate({ params: IdParams, body: MemoryPatch }), memories.update);
  router.delete('/agent/memories/:id', requirePermission('agent_memory.manage'), id, memories.remove);

  router.get('/intake-fields', requirePermission('intake.read'), intake.list);
  router.post('/intake-fields', requirePermission('intake.write'), validate({ body: IntakeFieldBody }), intake.create);
  router.patch('/intake-fields/:id', requirePermission('intake.write'), validate({ params: IdParams, body: IntakeFieldPatch }), intake.update);
  router.delete('/intake-fields/:id', requirePermission('intake.write'), id, intake.remove);

  return router;
}
