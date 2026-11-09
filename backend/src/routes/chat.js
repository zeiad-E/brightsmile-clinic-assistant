import { Router } from 'express';
import * as chat from '../controllers/chatController.js';
import { csrfGuard } from '../auth/csrf.js';
import { validate } from '../middlewares/validate.js';
import { IdParams } from '../validators/common.js';
import { ChatBody } from '../validators/chat.js';

// Answers depend on who is asking (sign-in or visitor cookie): no browser or proxy may keep a copy,
// or one visitor could be shown another's chat from the same URL.
function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

/**
 * /api/chat — the patient assistant. Open to visitors and signed-in patients. A visitor's chat
 * belongs to their browser (visitor cookie) and moves to their account when they sign in or book.
 * The chat reads a cookie, so sending needs the website's own header (csrfGuard), like /api/auth.
 */
export function chatRouter(limits) {
  const router = Router();
  router.use(noStore);
  router.use(csrfGuard());

  router.post('/', limits.chat, validate({ body: ChatBody }), chat.send);
  router.post('/stream', limits.chat, validate({ body: ChatBody }), chat.stream); // same turn, live progress (SSE)
  router.get('/current', chat.current); // before /:id, or "current" would be read as an id
  router.get('/:id', validate({ params: IdParams }), chat.history);

  return router;
}
