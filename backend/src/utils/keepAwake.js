import { logger } from './logger.js';

/**
 * Render's free plan puts the server to sleep after 15 minutes without visitors, and the first
 * visitor after that waits a minute or two while it wakes up.
 *
 * So the server visits itself: every 10 minutes it asks its own PUBLIC address for /health. That
 * request goes out and comes back in through Render, so Render counts it as a visitor and never
 * puts the server to sleep. (A timer inside the server alone doesn't count: Render only sees
 * requests that come in from outside.)
 *
 * Only on Render, where RENDER_EXTERNAL_URL (the server's public address) is set automatically.
 * On your computer it does nothing.
 *
 * Note: a free server awake all month uses about 720-744 of Render's 750 free hours, so this works
 * only while it is the one free Render service on the account.
 */
const EVERY_MS = 10 * 60 * 1000;

export function keepAwake(publicUrl = process.env.RENDER_EXTERNAL_URL) {
  if (!publicUrl) return null;
  const url = new URL('/health', publicUrl).toString();
  const timer = setInterval(async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) logger.warn(`Keep-awake ping got HTTP ${res.status}`);
    } catch (err) {
      logger.warn(`Keep-awake ping failed: ${err.message}`);
    }
  }, EVERY_MS);
  timer.unref(); // never keeps the process alive on its own (tests, shutdown)
  logger.info(`Keep-awake: pinging ${url} every 10 minutes`);
  return timer;
}
