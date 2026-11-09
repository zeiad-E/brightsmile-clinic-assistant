import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { fakeSessionsModule, fakeSupabaseModule, ROLE_IDS } from '../helpers/fakeAuth.js';

/**
 * Signing in on this browser takes the chats it had as a guest (visitor cookie) into the account,
 * then clears the cookie; signing out clears it too. The chat service itself is a fake here.
 */
vi.mock('../../../src/db/supabase.js', () => fakeSupabaseModule());
vi.mock('../../../src/auth/sessions.js', () => fakeSessionsModule());
vi.mock('../../../src/services/authService.js', () => ({
  phoneLogin: vi.fn(async () => ({ profile: { id: ROLE_IDS.patient, role: 'patient' }, method: 'phone' })),
  staffLogin: vi.fn(async () => ({ profile: { id: ROLE_IDS.staff, role: 'staff' }, method: 'password' })),
}));
vi.mock('../../../src/services/chatService.js', () => ({ claimVisitorChats: vi.fn(async () => ['c1']) }));

const chatService = await import('../../../src/services/chatService.js');
const { sha256Hex } = await import('../../../src/auth/secrets.js');
const { createApp } = await import('../../../src/app.js');
const app = createApp({ rateLimit: false });

const SECRET = 'v'.repeat(43);
const post = (path, body) => request(app).post(`/api${path}`).set('x-brightsmile-client', 'web').set('cookie', `bs_vid=${SECRET}`).send(body);
const PHONE = { phone: '+201001234567', full_name: 'Ahmed Ali', date_of_birth: '1990-01-01' };
const cleared = (res) => (res.headers['set-cookie'] ?? []).some((c) => c.startsWith('bs_vid=;') && /Path=\/api;/.test(c));

beforeEach(() => vi.clearAllMocks());

describe('guest chats on sign-in and sign-out', () => {
  it('a patient signing in takes this browser’s guest chats, then the cookie is cleared', async () => {
    const res = await post('/auth/phone', PHONE);

    expect(res.status).toBe(200);
    expect(chatService.claimVisitorChats).toHaveBeenCalledWith({ visitorHash: sha256Hex(SECRET), profileId: ROLE_IDS.patient });
    expect(cleared(res)).toBe(true);
  });

  it('the chat’s own sign-in (ticket swap) takes them too', async () => {
    const res = await post('/auth/ticket', { ticket: 'x'.repeat(20) });

    expect(res.status).toBe(200);
    expect(chatService.claimVisitorChats).toHaveBeenCalledWith({ visitorHash: sha256Hex(SECRET), profileId: ROLE_IDS.patient });
    expect(cleared(res)).toBe(true);
  });

  it('a team sign-in takes nothing and leaves the cookie alone', async () => {
    const res = await post('/auth/staff/login', { email: 'a@b.co', password: 'x' });

    expect(res.status).toBe(200);
    expect(chatService.claimVisitorChats).not.toHaveBeenCalled();
    expect(cleared(res)).toBe(false);
  });

  it('a failure to move the chats never blocks the sign-in, and the cookie stays for next time', async () => {
    chatService.claimVisitorChats.mockRejectedValueOnce(new Error('database down'));
    const res = await post('/auth/phone', PHONE);

    expect(res.status).toBe(200);
    expect(cleared(res)).toBe(false);
  });

  it('signing out clears the cookie, so the next person on this browser starts fresh', async () => {
    const res = await post('/auth/logout', {});

    expect(res.status).toBe(204);
    expect(cleared(res)).toBe(true);
  });
});
