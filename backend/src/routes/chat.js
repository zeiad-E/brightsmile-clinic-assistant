import { Router } from 'express';
import { runAgentTurn } from '../agent/loop.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * POST /api/chat
 * body: { messages: [{role, content}], context?: { language, patientId, conversationId } }
 * Returns the agent's reply. (Streaming to be added via SSE.)
 */
router.post('/', async (req, res) => {
  const { messages, context } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages[] is required' });
  }

  try {
    const result = await runAgentTurn({ messages, context: context ?? {} });
    res.json(result);
  } catch (err) {
    logger.error(`/api/chat failed: ${err.message}`);
    res.status(500).json({ error: 'agent_error' });
  }
});

export default router;
