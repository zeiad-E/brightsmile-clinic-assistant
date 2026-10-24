/**
 * An error we throw on purpose, carrying what the client should see:
 * an HTTP status, a stable snake_case code (e.g. `slot_taken`) the frontend can
 * switch on, a human message, and optional details.
 *
 * Anything that is NOT an AppError is treated as a bug: logged in full,
 * answered with a generic 500 so internals never leak to the client.
 */
export class AppError extends Error {
  constructor(status, code, message = code, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(code = 'bad_request', message, details) {
    return new AppError(400, code, message, details);
  }

  static unauthorized(code = 'unauthorized', message = 'Please sign in first.') {
    return new AppError(401, code, message);
  }

  static forbidden(code = 'forbidden', message = 'You are not allowed to do this.') {
    return new AppError(403, code, message);
  }

  static notFound(code = 'not_found', message = 'Not found.') {
    return new AppError(404, code, message);
  }

  static conflict(code = 'conflict', message, details) {
    return new AppError(409, code, message, details);
  }
}
