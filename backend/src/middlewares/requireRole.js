import { AppError } from '../utils/AppError.js';

/**
 * Lets only the given roles through. Runs after authenticate().
 *
 * 401 = we don't know who you are (sign in). 403 = we know, and you're not allowed.
 *
 * This is the FIRST wall. For routes that use the user's own database client, Row Level
 * Security is a second wall behind it. For routes that must use the service role (which
 * skips RLS), this check is the only wall — so every such route must have it.
 */
export function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, _res, next) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!allowed.includes(req.user.role)) return next(AppError.forbidden());
    return next();
  };
}
