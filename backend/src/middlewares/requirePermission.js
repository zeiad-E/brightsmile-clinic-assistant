import { ALL_PERMISSIONS, can } from '../auth/permissions.js';
import { AppError } from '../utils/AppError.js';

/**
 * Lets a request through only if the caller holds this permission. Runs after authenticate().
 *
 * 401 = we don't know who you are (sign in). 403 = we know, and you're not allowed.
 *
 * This is the only wall: the database stores data and doesn't check who is asking. So every
 * signed-in route must have this guard, and tests/unit/permissions.test.js fails if one doesn't.
 */
export function requirePermission(permission) {
  if (!ALL_PERMISSIONS.includes(permission)) throw new Error(`Unknown permission: ${permission}`);

  const guard = (req, _res, next) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!can(req.user, permission)) return next(AppError.forbidden());
    return next();
  };
  guard.permission = permission;
  return guard;
}
