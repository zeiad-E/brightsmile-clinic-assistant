import { AppError } from '../utils/AppError.js';

/** Stops anonymous visitors: 401 "please sign in". Runs after authenticate(). */
export function requireAuth() {
  return (req, _res, next) => {
    if (!req.user) return next(AppError.unauthorized());
    return next();
  };
}
