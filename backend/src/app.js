import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/index.js';
import { createApiRouter } from './routes/index.js';
import { llmAdminDoor } from './middlewares/llmAdminDoor.js';
import { requestContext } from './middlewares/requestContext.js';
import { evalPass } from './middlewares/evalPass.js';
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
export function createApp({ rateLimit = true } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Requests reach us through Cloudflare and Render's load balancer. Trusting exactly those hops
  // makes `req.ip` the visitor's real address (counted from the right, so it can't be faked).
  app.set('trust proxy', config.trustProxyHops);

  // Must run before body parsing: it proxies raw requests to the LLM engine dashboard.
  // It also runs before helmet, so helmet's strict headers don't break that dashboard.
  app.use(llmAdminDoor());

  app.use(requestContext());
  app.use(evalPass());
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));

  // Health check (also used by the keep-warm cron to avoid free-tier cold starts)
  // `version` = the deployed git commit (Render sets RENDER_GIT_COMMIT), to confirm a deploy is live.
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'caredesk-backend',
      version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? 'local',
      time: new Date().toISOString(),
    });
  });

  // Routes (tests can switch rate limiting off to send many requests quickly)
  app.use('/api', createApiRouter({ rateLimit }));

  // Nothing matched → 404, and every error → one JSON shape. These two always stay last.
  app.use(notFound());
  app.use(errorHandler());

  return app;
}
