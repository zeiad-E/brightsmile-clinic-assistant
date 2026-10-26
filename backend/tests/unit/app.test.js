import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';

describe('app wiring', () => {
  const app = createApp();

  it('answers the health check', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'caredesk-backend' });
  });

  it('turns an unknown route into a JSON 404', async () => {
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'route_not_found', message: 'No route for GET /api/does-not-exist' });
  });

  it('rejects a body that is not valid JSON', async () => {
    const res = await request(app).post('/api/chat').set('content-type', 'application/json').send('{"broken"');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_json');
  });

  it('rejects a body over 100kb', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ messages: [{ role: 'user', content: 'x'.repeat(110_000) }] });

    expect(res.status).toBe(413);
    expect(res.body.error).toBe('payload_too_large');
  });

  it('validates chat messages', async () => {
    const empty = await request(app).post('/api/chat').send({});
    const tooLong = await request(app).post('/api/chat').send({ message: 'x'.repeat(1001) });

    expect(empty.status).toBe(400);
    expect(empty.body.details[0].path).toBe('message');
    expect(tooLong.status).toBe(400);
  });

  it('gives every response a request id and security headers', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-request-id']).toMatch(/^[\w-]{8,64}$/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('reuses a sane incoming request id but not a malicious one', async () => {
    const ok = await request(app).get('/health').set('x-request-id', 'trace-12345678');
    const bad = await request(app).get('/health').set('x-request-id', '<script>alert(1)</script>');

    expect(ok.headers['x-request-id']).toBe('trace-12345678');
    expect(bad.headers['x-request-id']).not.toContain('script');
  });
});
