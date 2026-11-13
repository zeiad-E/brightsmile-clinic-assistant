import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { createApp } from './app.js';
import { registerJobHandlers } from './services/jobs/handlers.js';
import { startJobRunner } from './services/jobs/jobRunner.js';
import { keepAwake } from './utils/keepAwake.js';

const app = createApp();

app.listen(config.port, () => {
  logger.info(`CareDesk backend listening on http://localhost:${config.port}`);
});

// Background work (summaries, reminders, waitlist emails, nightly clean-up) runs inside the same server.
registerJobHandlers();
startJobRunner();

// On Render's free plan: visit ourselves every 10 minutes so the server never falls asleep.
keepAwake();
