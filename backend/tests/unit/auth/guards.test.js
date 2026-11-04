import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../../../src/config/index.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../../../src/auth/cookies.js';
import { csrfGuard } from '../../../src/auth/csrf.js';
import { emailCodeFingerprint } from '../../../src/auth/emailCodes.js';
import { hmacHex, randomToken, safeEqual, sha256Hex, sixDigitCode } from '../../../src/auth/secrets.js';
import { normalizePersonName } from '../../../src/auth/normalizeName.js';
import { createAttemptLimiter } from '../../../src/auth/attemptLimiter.js';
import { requestContext } from '../../../src/middlewares/requestContext.js';

const { cookieSecure } = config.auth;
const { proxySharedSecret } = config;

afterEach(() => {
  config.auth.cookieSecure = cookieSecure;
  config.proxySharedSecret = proxySharedSecret;
});

describe('small helpers', () => {
  it('compares secrets exactly, whatever their length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('makes 6-digit codes, keeping leading zeros', () => {
    for (let i = 0; i < 500; i += 1) expect(sixDigitCode()).toMatch(/^\d{6}$/);
  });

  it('makes long, different tokens', () => {
    expect(randomToken()).toHaveLength(43);
    expect(randomToken()).not.toBe(randomToken());
  });

  it('fingerprints with and without a key', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hmacHex('key', 'abc')).not.toBe(hmacHex('other', 'abc'));
    expect(() => hmacHex('', 'abc')).toThrow(/secret/);
  });
});

describe('email code fingerprints', () => {
  it('only match the same code, for the same person and purpose', () => {
    const base = emailCodeFingerprint('sign_in', 'mona@example.com', '123456');

    expect(emailCodeFingerprint('sign_in', 'MONA@example.com ', '123456')).toBe(base);
    expect(emailCodeFingerprint('sign_up', 'mona@example.com', '123456')).not.toBe(base);
    expect(emailCodeFingerprint('sign_in', 'other@example.com', '123456')).not.toBe(base);
    expect(emailCodeFingerprint('sign_in', 'mona@example.com', '123457')).not.toBe(base);
  });
});

describe('name comparison (same rules as the database)', () => {
  it.each([
    ['  Mona   ALI ', 'mona ali'],
    ['أحمد  إبراهيم', 'احمد ابراهيم'],
    ['آية', 'ايه'],
    ['ٱسلام', 'اسلام'],
    ['مُنَى', 'مني'],
    ['فاطمة', 'فاطمه'],
    ['عبـــد الله', 'عبد الله'],
    [null, ''],
  ])('%s → %s', (input, expected) => {
    expect(normalizePersonName(input)).toBe(expected);
  });
});

describe('the refresh cookie', () => {
  const app = express();
  app.get('/set', (_req, res) => {
    setRefreshCookie(res, 'session.secret', 60_000);
    res.end();
  });
  app.get('/clear', (_req, res) => {
    clearRefreshCookie(res);
    res.end();
  });

  it('is hidden from scripts, stays on our site and only goes to the sign-in routes', async () => {
    const [cookie] = (await request(app).get('/set')).headers['set-cookie'];

    expect(cookie).toMatch(/^bs_rt=session\.secret;/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(cookie).toMatch(/Max-Age=60/);
    expect(cookie).not.toMatch(/Domain/);
    expect(cookie).not.toMatch(/Secure/);
  });

  it('is HTTPS-only when configured', async () => {
    config.auth.cookieSecure = true;

    expect((await request(app).get('/set')).headers['set-cookie'][0]).toMatch(/Secure/);
  });

  it('can be cleared', async () => {
    const [cookie] = (await request(app).get('/clear')).headers['set-cookie'];

    expect(cookie).toMatch(/^bs_rt=;/);
    expect(cookie).toMatch(/Path=\/api\/auth/);
  });

  it('is read from the request, among other cookies', () => {
    expect(readRefreshCookie({ get: () => 'lang=ar; bs_rt=a.b; x=1' })).toBe('a.b');
    expect(readRefreshCookie({ get: () => 'lang=ar' })).toBeNull();
    expect(readRefreshCookie({ get: () => undefined })).toBeNull();
  });
});

describe('the cross-site guard on cookie routes', () => {
  const run = (req) => {
    const headers = Object.fromEntries(Object.entries(req.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    let passed = false;
    csrfGuard()({ method: req.method ?? 'POST', get: (name) => headers[name.toLowerCase()] }, {}, () => {
      passed = true;
    });
    return passed;
  };
  const OURS = { 'X-BrightSmile-Client': 'web' };

  it('lets reads through', () => {
    expect(run({ method: 'GET' })).toBe(true);
  });

  it('needs our header on a write', () => {
    expect(() => run({})).toThrow(expect.objectContaining({ code: 'request_blocked', status: 403 }));
    expect(() => run({ headers: { 'X-BrightSmile-Client': 'other' } })).toThrow(expect.objectContaining({ code: 'request_blocked' }));
  });

  it('allows requests without an Origin (not from a browser page) and from our site', () => {
    expect(run({ headers: OURS })).toBe(true);
    expect(run({ headers: { ...OURS, Origin: config.appUrl } })).toBe(true);
  });

  it('allows a temporary site address, which arrives as the forwarded host', () => {
    expect(run({ headers: { ...OURS, Origin: 'https://abc.trycloudflare.com', 'X-Forwarded-Host': 'abc.trycloudflare.com' } })).toBe(true);
  });

  it('blocks another website, even with our header', () => {
    expect(() => run({ headers: { ...OURS, Origin: 'https://evil.example' } })).toThrow(expect.objectContaining({ code: 'request_blocked' }));
    expect(() => run({ headers: { ...OURS, Origin: 'https://evil.example', 'X-Forwarded-Host': 'our.site' } })).toThrow(expect.objectContaining({ code: 'request_blocked' }));
    expect(() => run({ headers: { ...OURS, Origin: 'null' } })).toThrow(expect.objectContaining({ code: 'request_blocked' }));
  });
});

describe('sign-in attempt limits', () => {
  const limiter = (start = 0) => {
    const clock = { now: start };
    return { clock, attempts: createAttemptLimiter({ now: () => clock.now }) };
  };
  const QUARTER_HOUR = 15 * 60 * 1000;

  it('stops a visitor after 5 wrong codes, for 15 minutes', () => {
    const { attempts, clock } = limiter();
    for (let i = 0; i < 5; i += 1) {
      attempts.assertAllowed('personal_code', '1.1.1.1');
      attempts.recordFailure('personal_code', '1.1.1.1');
    }

    expect(() => attempts.assertAllowed('personal_code', '1.1.1.1')).toThrow(expect.objectContaining({ status: 429, code: 'too_many_attempts' }));
    expect(() => attempts.assertAllowed('personal_code', '2.2.2.2')).not.toThrow();

    clock.now += QUARTER_HOUR + 1;
    expect(() => attempts.assertAllowed('personal_code', '1.1.1.1')).not.toThrow();
  });

  it('counts each way of signing in on its own', () => {
    const { attempts } = limiter();
    for (let i = 0; i < 5; i += 1) attempts.recordFailure('personal_code', '1.1.1.1');

    expect(() => attempts.assertAllowed('phone', '1.1.1.1')).not.toThrow();
  });

  it('pauses code sign-in for everyone after many failures across the clinic', () => {
    const { attempts, clock } = limiter();
    for (let i = 0; i < 50; i += 1) attempts.recordFailure('personal_code', `10.0.0.${i}`);

    expect(() => attempts.assertAllowed('personal_code', '9.9.9.9')).toThrow(expect.objectContaining({ status: 429, code: 'sign_in_paused' }));
    expect(() => attempts.assertAllowed('phone', '9.9.9.9')).not.toThrow();

    clock.now += QUARTER_HOUR + 1;
    expect(() => attempts.assertAllowed('personal_code', '9.9.9.9')).not.toThrow();
  });
});

describe('the visitor address', () => {
  const app = express();
  app.use(requestContext());
  app.get('/ip', (req, res) => res.json({ ip: req.clientIp }));
  const SECRET = 'a-shared-secret-of-at-least-32-characters';
  const ask = (headers = {}) => request(app).get('/ip').set(headers);

  it('uses the address the site reports, when the secret proves it came from the site', async () => {
    config.proxySharedSecret = SECRET;

    expect((await ask({ 'x-bs-proxy-key': SECRET, 'x-bs-client-ip': '203.0.113.9' })).body.ip).toBe('203.0.113.9');
  });

  it('ignores a claimed address without the right secret', async () => {
    config.proxySharedSecret = SECRET;

    expect((await ask({ 'x-bs-client-ip': '203.0.113.9' })).body.ip).not.toBe('203.0.113.9');
    expect((await ask({ 'x-bs-proxy-key': 'guess', 'x-bs-client-ip': '203.0.113.9' })).body.ip).not.toBe('203.0.113.9');
  });

  it('ignores it when no secret is configured', async () => {
    config.proxySharedSecret = '';

    expect((await ask({ 'x-bs-proxy-key': '', 'x-bs-client-ip': '203.0.113.9' })).body.ip).not.toBe('203.0.113.9');
  });

  it('ignores something that is not an address', async () => {
    config.proxySharedSecret = SECRET;

    expect((await ask({ 'x-bs-proxy-key': SECRET, 'x-bs-client-ip': 'not-an-ip' })).body.ip).not.toBe('not-an-ip');
  });
});
