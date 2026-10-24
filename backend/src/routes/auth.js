import { Router } from 'express';
import * as auth from '../controllers/authController.js';
import { validate } from '../middlewares/validate.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireRole } from '../middlewares/requireRole.js';
import { ROLES } from '../utils/roles.js';
import { CodeLoginBody, EmailStartBody, EmailVerifyBody, PasswordBody, PhoneLoginBody, RefreshBody, StaffLoginBody } from '../validators/auth.js';

/** /api/auth — every way to sign in, plus session and password actions. */
export function authRouter(limits) {
  const router = Router();

  router.post('/staff/login', limits.auth, validate({ body: StaffLoginBody }), auth.staffLogin);
  router.post('/email/start', limits.auth, validate({ body: EmailStartBody }), auth.emailStart);
  router.post('/email/verify', limits.auth, validate({ body: EmailVerifyBody }), auth.emailVerify);
  router.post('/phone', limits.auth, validate({ body: PhoneLoginBody }), auth.phone);
  router.post('/code', limits.code, validate({ body: CodeLoginBody }), auth.code);
  router.post('/code/resend', limits.auth, validate({ body: EmailStartBody }), auth.codeResend);
  router.post('/refresh', limits.auth, validate({ body: RefreshBody }), auth.refresh);

  router.post('/logout', requireAuth(), auth.logout);
  router.get('/me', requireAuth(), auth.me);
  router.post('/password', requireRole(ROLES.TEAM), limits.auth, validate({ body: PasswordBody }), auth.changePassword);

  return router;
}
