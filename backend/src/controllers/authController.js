import * as authService from '../services/authService.js';
import { ctxOf } from './context.js';

/** Sign-in and account endpoints (/api/auth). Each handler: read req.valid → one service call → JSON. */

export async function staffLogin(req, res) {
  res.json(await authService.staffLogin(req.valid.body));
}

export async function emailStart(req, res) {
  res.json(await authService.startEmailCode(req.valid.body));
}

export async function emailVerify(req, res) {
  res.json(await authService.verifyEmailCode(req.valid.body));
}

export async function phone(req, res) {
  res.json(await authService.phoneLogin(req.valid.body));
}

export async function code(req, res) {
  res.json(await authService.codeLogin(req.valid.body));
}

export async function codeResend(req, res) {
  res.json(await authService.resendCode(req.valid.body));
}

export async function refresh(req, res) {
  res.json(await authService.refresh(req.valid.body));
}

export async function logout(req, res) {
  await authService.logout(req.token);
  res.status(204).end();
}

export async function me(req, res) {
  res.json(await authService.me(ctxOf(req)));
}

export async function changePassword(req, res) {
  res.json(await authService.changePassword(ctxOf(req), req.valid.body));
}

export async function profile(req, res) {
  res.json(await authService.teamProfile(ctxOf(req)));
}

export async function updateProfile(req, res) {
  res.json(await authService.updateTeamProfile(ctxOf(req), req.valid.body));
}
