import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A patient's own code: every look is on the record, and the record never holds the code. */
vi.mock('../../src/db/supabase.js', () => ({ requireAdmin: () => ({}) }));
vi.mock('../../src/auth/sessions.js', () => ({ revokeAllFor: vi.fn() }));
vi.mock('../../src/models/auditModel.js', () => ({ record: vi.fn() }));
vi.mock('../../src/models/patientModel.js', () => ({ findCode: vi.fn(), setCode: vi.fn() }));

const { encryptPersonalCode } = await import('../../src/auth/personalCodes.js');
const { replaceMine, showMine } = await import('../../src/services/personalCodeService.js');
const sessions = await import('../../src/auth/sessions.js');
const auditModel = await import('../../src/models/auditModel.js');
const patientModel = await import('../../src/models/patientModel.js');

const ctx = { user: { id: 'profile-1', patientId: 'patient-1', sessionId: 'this-device' } };

function savedCode(code) {
  const { ciphertext, keyId } = encryptPersonalCode(code, 'patient-1');
  patientModel.findCode.mockResolvedValue({ code_hmac: 'x', code_ciphertext: ciphertext, code_key_id: keyId, code_issued_at: '2026-11-04T10:00:00Z' });
}

beforeEach(() => vi.clearAllMocks());

describe('showing the code', () => {
  it('returns it and records who looked, without the code', async () => {
    savedCode('K7Q4-9M2X');

    expect(await showMine(ctx)).toEqual({ code: 'K7Q4-9M2X', legacy: false, issued_at: '2026-11-04T10:00:00Z' });

    const entry = auditModel.record.mock.calls[0][1];
    expect(entry).toMatchObject({ actorId: 'profile-1', action: 'personal_code.viewed', entity: 'patients', entityId: 'patient-1' });
    expect(JSON.stringify(entry)).not.toContain('K7Q4');
  });

  it('records printing separately', async () => {
    savedCode('K7Q4-9M2X');

    await showMine(ctx, { forPrint: true });

    expect(auditModel.record.mock.calls[0][1].action).toBe('personal_code.printed');
  });

  it('an old hash-only code can only be replaced: nothing was shown, so nothing is recorded', async () => {
    patientModel.findCode.mockResolvedValue({ code_hmac: 'x', code_ciphertext: null });

    expect(await showMine(ctx)).toMatchObject({ code: null, legacy: true });
    expect(auditModel.record).not.toHaveBeenCalled();
  });
});

describe('a new code', () => {
  it('signs out the other devices but keeps this one, and goes on the record', async () => {
    patientModel.setCode.mockResolvedValue({ id: 'patient-1' });

    const { code } = await replaceMine(ctx);

    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(sessions.revokeAllFor).toHaveBeenCalledWith('profile-1', 'code_changed', { exceptId: 'this-device' });
    expect(auditModel.record.mock.calls[0][1].action).toBe('personal_code.regenerated');
  });
});
