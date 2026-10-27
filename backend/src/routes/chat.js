import { Router } from 'express';
import * as chat from '../controllers/chatController.js';
import { validate } from '../middlewares/validate.js';
import { IdParams } from '../validators/common.js';
import { ChatBody } from '../validators/chat.js';

/**
 * /api/chat — the patient assistant. Open to visitors and signed-in patients;
 * a conversation becomes private to a patient once they sign in or book.
 */
export function chatRouter(limits) {
  const router = Router();

  router.post('/', limits.chat, validate({ body: ChatBody }), chat.send);
  router.post('/stream', limits.chat, validate({ body: ChatBody }), chat.stream); // same turn, live progress (SSE)
  router.get('/:id', validate({ params: IdParams }), chat.history);

  return router;
}
