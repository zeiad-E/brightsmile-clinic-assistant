import { ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

/**
 * The single place where errors become HTTP responses.
 *
 * Every error reaches the client in one shape: `{ error, message, details? }`.
 * `error` is a stable snake_case code the frontend can rely on.
 *
 * Express 5 forwards errors thrown in async handlers here automatically, so
 * controllers just `throw` and never need their own try/catch.
 */

// Postgres / PostgREST error codes that can happen through normal use, not bugs.
const DB_ERRORS = {
  '23P01': [409, 'slot_taken', 'That time was just booked by someone else.'], // exclusion constraint
  23505: [409, 'conflict', 'This already exists.'], // unique violation
  23503: [422, 'invalid_reference', 'A referenced record does not exist.'], // foreign key
  23514: [422, 'invalid_value', 'A value is not allowed.'], // check constraint
  '22P02': [400, 'invalid_input', 'A value has the wrong format.'], // e.g. a bad uuid
  42501: [403, 'forbidden', 'You are not allowed to do this.'], // blocked by RLS / grants
  PGRST116: [404, 'not_found', 'Not found.'], // `.single()` matched no row
};

function toResponse(err) {
  if (err instanceof AppError) {
    return { status: err.status, body: { error: err.code, message: err.message, details: err.details } };
  }

  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
    return { status: 400, body: { error: 'validation_error', message: 'Some fields are invalid.', details } };
  }

  // Thrown by express.json() for unreadable or oversized bodies.
  if (err?.type === 'entity.parse.failed') {
    return { status: 400, body: { error: 'invalid_json', message: 'The request body is not valid JSON.' } };
  }
  if (err?.type === 'entity.too.large') {
    return { status: 413, body: { error: 'payload_too_large', message: 'The request body is too large.' } };
  }

  // File uploads (multer).
  if (err?.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') return { status: 413, body: { error: 'file_too_large', message: 'Files can be up to 10 MB.' } };
    return { status: 400, body: { error: 'invalid_upload', message: 'Send one file in the "file" field.' } };
  }

  const known = DB_ERRORS[err?.code];
  if (known) {
    const [status, code, message] = known;
    return { status, body: { error: code, message } };
  }

  return null;
}

export function errorHandler() {
  // Express recognises an error handler by its four parameters, so `_next` must stay.
  return (err, req, res, _next) => {
    if (res.headersSent) return req.socket.destroy();

    const known = toResponse(err);
    if (known) {
      if (known.status >= 500) logger.error(`${req.method} ${req.path} id=${req.id}: ${err.message}`);
      return res.status(known.status).json(known.body);
    }

    // Unknown error = a bug. Log everything, tell the client nothing internal.
    logger.error(`Unhandled error on ${req.method} ${req.path} id=${req.id}:`, err);
    return res.status(500).json({
      error: 'internal_error',
      message: 'Something went wrong on our side.',
      requestId: req.id,
    });
  };
}
