import { AppError } from '../utils/AppError.js';

/** Any request that matched no route ends here and becomes a JSON 404. */
export function notFound() {
  return (req, _res, next) => {
    next(AppError.notFound('route_not_found', `No route for ${req.method} ${req.path}`));
  };
}
