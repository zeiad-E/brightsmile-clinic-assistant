import { logger } from '../../../utils/logger.js';

/**
 * Doesn't send anything — prints the email instead. For local development and tests.
 * In production only the subject is printed, so codes and passwords never reach the logs.
 */
export function createLogAdapter({ showBody }) {
  return {
    name: 'log',
    async send({ to, subject, text }) {
      logger.info(`[email:log] to=${to} subject="${subject}"${showBody ? `\n${text}` : ''}`);
    },
  };
}
