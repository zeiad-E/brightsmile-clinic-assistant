import express from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import chatRouter from './routes/chat.js';
import { llmAdminDoor } from './middlewares/llmAdminDoor.js';

const app = express();
app.disable('x-powered-by');

// Must run before body parsing: it proxies raw requests to the LLM engine dashboard.
app.use(llmAdminDoor());

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

// Health check (also used by the keep-warm cron to avoid free-tier cold starts)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'caredesk-backend', time: new Date().toISOString() });
});

// Routes
app.use('/api/chat', chatRouter);
// TODO: app.use('/api/auth', authRouter);
// TODO: app.use('/api/appointments', appointmentsRouter);
// TODO: app.use('/api/knowledge', knowledgeRouter);
// TODO: app.use('/api/dashboard', dashboardRouter);

app.listen(config.port, () => {
  logger.info(`CareDesk backend listening on http://localhost:${config.port}`);
});
