import { beforeEach, describe, expect, it, vi } from 'vitest';

const saved = { intake: {} };
const jobs = { queue: [], done: [], failed: [] };

vi.mock('../../../src/db/supabase.js', () => ({ requireAdmin: () => ({}), supabaseAdmin: {} }));
vi.mock('../../../src/models/intakeModel.js', () => ({
  listActive: vi.fn(async () => [
    {
      key: 'insurance',
      kind: 'choice',
      label_en: 'Insurance company',
      options: [
        { value: 'nilecare', label_en: 'NileCare Health', label_ar: 'نايل كير' },
        { value: 'none', label_en: 'No insurance (self-pay)', label_ar: 'بدون تأمين' },
      ],
    },
    { key: 'city', kind: 'text', label_en: 'City / area', options: [] },
  ]),
}));
vi.mock('../../../src/models/patientModel.js', () => ({
  getIntake: vi.fn(async () => saved.intake),
  setIntake: vi.fn(async (_db, _id, intake) => {
    saved.intake = intake;
  }),
}));
vi.mock('../../../src/models/jobModel.js', () => ({
  claim: vi.fn(async () => jobs.queue.splice(0)),
  complete: vi.fn(async (_db, id) => jobs.done.push(id)),
  fail: vi.fn(async (_db, job, error) => jobs.failed.push({ id: job.id, error })),
}));

const intake = await import('../../../src/services/intakeService.js');
const { registerJob, processDueJobs } = await import('../../../src/services/jobs/jobRunner.js');

beforeEach(() => {
  saved.intake = {};
  jobs.queue.length = 0;
  jobs.done.length = 0;
  jobs.failed.length = 0;
});

describe('intake answers', () => {
  it('maps a typed insurer name (EN or AR) to its stored value', async () => {
    expect((await intake.saveAnswers('p1', { insurance: 'nilecare health' })).saved).toEqual({ insurance: 'nilecare' });
    expect((await intake.saveAnswers('p1', { insurance: 'بدون تأمين' })).saved).toEqual({ insurance: 'none' });
  });

  it('keeps earlier answers and rejects unknown questions or invalid choices', async () => {
    saved.intake = { city: 'Heliopolis' };
    const result = await intake.saveAnswers('p1', { insurance: 'Some Other Co', allergies: 'penicillin' });

    expect(result.saved).toEqual({});
    expect(result.rejected.map((r) => r.key)).toEqual(['insurance', 'allergies']);
    expect(saved.intake).toEqual({ city: 'Heliopolis' });
  });

  it('lists only the questions still unanswered', async () => {
    saved.intake = { insurance: 'none' };
    expect((await intake.missingFor('p1')).map((f) => f.key)).toEqual(['city']);
  });
});

describe('background job runner', () => {
  it('runs due jobs, marks success, and records failures for a retry', async () => {
    const ran = [];
    registerJob('ok_job', async (payload) => ran.push(payload.n));
    registerJob('bad_job', async () => {
      throw new Error('LLM down');
    });
    jobs.queue.push({ id: 1, type: 'ok_job', payload: { n: 7 } }, { id: 2, type: 'bad_job', payload: {} }, { id: 3, type: 'unknown', payload: {} });

    expect(await processDueJobs({})).toBe(3);
    expect(ran).toEqual([7]);
    expect(jobs.done).toEqual([1]);
    expect(jobs.failed.map((f) => f.id)).toEqual([2, 3]);
    expect(jobs.failed[0].error).toBe('LLM down');
  });
});
