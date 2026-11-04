import { Router } from 'express';
import * as auth from '../controllers/authController.js';
import { csrfGuard } from '../auth/csrf.js';
import { validate } from '../middlewares/validate.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requirePermission } from '../middlewares/requirePermission.js';
import {
  CodeLoginBody,
  EmailStartBody,
  EmailVerifyBody,
  PasswordBody,
  PhoneLoginBody,
  StaffLoginBody,
  TeamProfilePatch,
  TicketBody,
} from '../validators/auth.js';

// Answers here carry tokens: no browser or proxy may keep a copy.
function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

/** /api/auth — every way to sign in, plus session and password actions. */
export function authRouter(limits) {
  const router = Router();
  router.use(noStore);
  router.use(csrfGuard());

  router.post('/staff/login', limits.auth, validate({ body: StaffLoginBody }), auth.staffLogin);
  router.post('/email/start', limits.auth, validate({ body: EmailStartBody }), auth.emailStart);
  router.post('/email/verify', limits.code, validate({ body: EmailVerifyBody }), auth.emailVerify);
  router.post('/phone', limits.auth, validate({ body: PhoneLoginBody }), auth.phone);
  router.post('/code', limits.code, validate({ body: CodeLoginBody }), auth.code);
  router.post('/code/resend', limits.auth, validate({ body: EmailStartBody }), auth.codeResend);
  router.post('/demo', limits.auth, auth.demo);
  router.post('/refresh', limits.refresh, auth.refresh);
  router.post('/ticket', limits.refresh, validate({ body: TicketBody }), auth.ticket);

  router.post('/logout', auth.logout);
  router.get('/me', requireAuth(), auth.me);
  // The read-only demo login can't change its password (or anything else).
  router.post('/password', requirePermission('account.password.change'), limits.auth, validate({ body: PasswordBody }), auth.changePassword);

  // A team member's own profile page (G6).
  router.get('/profile', requirePermission('account.profile.read'), auth.profile);
  router.patch('/profile', requirePermission('account.profile.update'), validate({ body: TeamProfilePatch }), auth.updateProfile);

  return router;
}
