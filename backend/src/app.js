import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/index.js';
import chatRouter from './routes/chat.js';
import { llmAdminDoor } from './middlewares/llmAdminDoor.js';
import { requestContext } from './middlewares/requestContext.js';
import { notFound } from './middlewares/notFound.js';
import { errorHandler } from './middlewares/errorHandler.js';

/**
 * Builds the Express app without starting it.
 *
 * Kept apart from `index.js` (which only calls `listen`) so tests can send
 * requests to a fresh app in memory, with no real port and no server to stop.
 *
 * Order matters: each request flows top to bottom through this list.
 */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Render puts one proxy in front of us; trust it so `req.ip` is the real client IP.
  app.set('trust proxy', 1);

  // Must run before body parsing: it proxies raw requests to the LLM engine dashboard.
  // It also runs before helmet, so helmet's strict headers don't break that dashboard.
  app.use(llmAdminDoor());

  app.use(requestContext());
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));

  // Health check (also used by the keep-warm cron to avoid free-tier cold starts)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'caredesk-backend', time: new Date().toISOString() });
  });

  // Routes
  app.use('/api/chat', chatRouter);

  // Nothing matched → 404, and every error → one JSON shape. These two always stay last.
  app.use(notFound());
  app.use(errorHandler());

  return app;
}
