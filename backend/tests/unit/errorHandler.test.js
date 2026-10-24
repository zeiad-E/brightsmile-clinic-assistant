import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { AppError } from '../../src/utils/AppError.js';
import { errorHandler } from '../../src/middlewares/errorHandler.js';
import { requestContext } from '../../src/middlewares/requestContext.js';
import { logger } from '../../src/utils/logger.js';

/** A tiny app whose only route throws whatever error the test gives it. */
function appThatThrows(error) {
  const app = express();
  app.use(requestContext());
  app.get('/boom', async () => {
    throw error;
  });
  app.use(errorHandler());
  return app;
}

describe('errorHandler', () => {
  it('sends an AppError as-is', async () => {
    const res = await request(appThatThrows(AppError.conflict('slot_taken', 'Taken.', { alternatives: [] }))).get(
      '/boom',
    );

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'slot_taken', message: 'Taken.', details: { alternatives: [] } });
  });

  it('turns a zod error into a 400 with field details', async () => {
    const zodError = z.object({ email: z.email() }).safeParse({ email: 'nope' }).error;
    const res = await request(appThatThrows(zodError)).get('/boom');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.details).toEqual([{ path: 'email', message: expect.any(String) }]);
  });

  it.each([
    ['23P01', 409, 'slot_taken'],
    ['23505', 409, 'conflict'],
    ['23503', 422, 'invalid_reference'],
    ['42501', 403, 'forbidden'],
    ['PGRST116', 404, 'not_found'],
  ])('maps database error %s to %i %s', async (code, status, error) => {
    const dbError = Object.assign(new Error('db said no'), { code });
    const res = await request(appThatThrows(dbError)).get('/boom');

    expect(res.status).toBe(status);
    expect(res.body.error).toBe(error);
  });

  it('hides the details of an unexpected error', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await request(appThatThrows(new Error('secret connection string leaked'))).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: 'internal_error',
      message: 'Something went wrong on our side.',
      requestId: res.headers['x-request-id'],
    });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
