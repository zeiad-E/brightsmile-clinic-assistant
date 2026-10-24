/**
 * Checks the request against zod schemas before the controller runs.
 *
 * Usage: validate({ params: IdParams, query: ListQuery, body: CreateBody })
 *
 * The cleaned values (trimmed, converted to numbers/dates, unknown fields dropped) go to
 * `req.valid.params / .query / .body`. Controllers read ONLY from `req.valid`, so they
 * never touch raw, unchecked input. (Express 5 makes `req.query` read-only, which is
 * another reason to keep the clean copy separately.)
 *
 * Invalid input throws a ZodError → errorHandler → 400 with one entry per bad field.
 */
const PARTS = ['params', 'query', 'body'];

export function validate(schemas) {
  return (req, _res, next) => {
    req.valid ??= {};
    for (const part of PARTS) {
      if (schemas[part]) req.valid[part] = schemas[part].parse(req[part] ?? {});
    }
    next();
  };
}
