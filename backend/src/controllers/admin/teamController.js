import * as teamService from '../../services/teamService.js';
import { ctxOf } from '../context.js';

/** Owner: team logins (/api/admin/team). */

export async function list(req, res) {
  res.json({ data: await teamService.list(ctxOf(req)) });
}

export async function create(req, res) {
  res.status(201).json(await teamService.create(ctxOf(req), req.valid.body));
}

export async function setRole(req, res) {
  res.json(await teamService.setRole(ctxOf(req), req.valid.params.id, req.valid.body.role));
}

export async function disable(req, res) {
  res.json(await teamService.setDisabled(ctxOf(req), req.valid.params.id, true));
}

export async function enable(req, res) {
  res.json(await teamService.setDisabled(ctxOf(req), req.valid.params.id, false));
}

export async function update(req, res) {
  res.json(await teamService.updateMember(ctxOf(req), req.valid.params.id, req.valid.body));
}

export async function resendInvite(req, res) {
  res.json(await teamService.resendInvite(ctxOf(req), req.valid.params.id));
}
