/** Tiny logger wrapper (swap for pino/winston later if needed). */
const ts = () => new Date().toISOString();

export const logger = {
  info: (...a) => console.log(`[INFO ${ts()}]`, ...a),
  warn: (...a) => console.warn(`[WARN ${ts()}]`, ...a),
  error: (...a) => console.error(`[ERROR ${ts()}]`, ...a),
};
