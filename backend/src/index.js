import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { createApp } from './app.js';

const app = createApp();

app.listen(config.port, () => {
  logger.info(`CareDesk backend listening on http://localhost:${config.port}`);
});
