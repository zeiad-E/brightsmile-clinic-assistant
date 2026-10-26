import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanText, detectKind, extractText } from '../../src/services/knowledge/extract.js';

const fixture = (name) => fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url));

describe('reading uploaded files', () => {
  it('reads the text of a real PDF (in a worker thread)', async () => {
    const bytes = fixture('sample.pdf');
    expect(detectKind('Clinic info.PDF', bytes)).toBe('pdf');
    expect(await extractText('pdf', bytes)).toBe('Parking: free parking behind the clinic.\nWheelchair access: ramp at the main door.');
  });

  it('reads English and Arabic from a real Word file', async () => {
    const bytes = fixture('sample.docx');
    expect(detectKind('payments.docx', bytes)).toBe('docx');
    expect(await extractText('docx', bytes)).toBe('Payment: we accept cash, cards and InstaPay.\n\nالدفع: نقدًا أو بالبطاقة أو إنستاباي.');
  });

  it('reads plain text and Markdown', async () => {
    const bytes = Buffer.from('# Prep\n\nDon’t eat 2 hours before whitening.');
    expect(detectKind('prep.md', bytes)).toBe('md');
    expect(await extractText('md', bytes)).toContain('Don’t eat 2 hours');
  });

  it('judges files by their content, not their name', () => {
    expect(detectKind('virus.pdf', Buffer.from('MZ\x90\x00 this is a program'))).toBeNull();
    expect(detectKind('fake.docx', Buffer.from('%PDF-1.4'))).toBeNull();
    expect(detectKind('binary.txt', Buffer.from([0x41, 0x00, 0x42]))).toBeNull();
    expect(detectKind('photo.jpg', Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });

  it('tidies extracted text', () => {
    expect(cleanText('  a  \r\n\r\n\r\n\r\n b\t\tc ')).toBe('a\n\nb c');
  });
});

// ---------- the service, with storage, database and jobs faked ----------
const store = { docs: new Map(), jobs: [], files: new Map(), removed: [] };

vi.mock('../../src/db/supabase.js', () => ({
  requireAdmin: () => ({
    storage: {
      from: () => ({
        upload: async (path, bytes) => {
          store.files.set(path, bytes);
          return { error: null };
        },
        download: async (path) => ({ data: new Blob([store.files.get(path)]), error: null }),
        remove: async (paths) => {
          store.removed.push(...paths);
          return { error: null };
        },
      }),
    },
  }),
}));
vi.mock('../../src/models/knowledgeModel.js', () => ({
  create: vi.fn(async (_db, row) => {
    if ([...store.docs.values()].some((d) => d.group_key === row.group_key && d.language === row.language)) {
      throw Object.assign(new Error('duplicate'), { code: '23505' });
    }
    const doc = { id: row.id ?? `d${store.docs.size + 1}`, ...row };
    store.docs.set(doc.id, doc);
    return doc;
  }),
  update: vi.fn(async (_db, id, patch) => (store.docs.has(id) ? Object.assign(store.docs.get(id), patch) : null)),
  findById: vi.fn(async (_db, id) => store.docs.get(id) ?? null),
  remove: vi.fn(async (_db, id) => store.docs.delete(id)),
  chunkCount: vi.fn(async () => 3),
}));
vi.mock('../../src/models/jobModel.js', () => ({ enqueue: vi.fn(async (_db, job) => store.jobs.push(job)) }));
vi.mock('../../src/rag/ingest.js', () => ({
  ingestDoc: vi.fn(async (doc) => {
    store.docs.get(doc.id).ingest_status = 'ready';
    return { ok: true };
  }),
}));

const service = await import('../../src/services/knowledge/knowledgeService.js');
const { ingestDoc } = await import('../../src/rag/ingest.js');
const ctx = { user: { id: 'owner-1' }, db: {} };
const fields = { group_key: 'facilities', language: 'en', category: 'location' };

beforeEach(() => {
  store.docs.clear();
  store.jobs.length = 0;
  store.files.clear();
  store.removed.length = 0;
  vi.clearAllMocks();
});

describe('knowledge service', () => {
  it('saves a typed document as pending and queues it for embedding', async () => {
    const doc = await service.create(ctx, { ...fields, title: 'Parking', content: 'Free parking behind the clinic building.' });

    expect(doc).toMatchObject({ source_type: 'manual', ingest_status: 'pending', created_by: 'owner-1' });
    expect(store.jobs).toEqual([{ type: 'ingest_knowledge', payload: { docId: doc.id, extract: false }, maxAttempts: 3 }]);
  });

  it('refuses a second document for the same topic and language', async () => {
    await service.create(ctx, { ...fields, title: 'A', content: 'Some content about the clinic.' });
    await expect(service.create(ctx, { ...fields, title: 'B', content: 'Other content about the clinic.' })).rejects.toMatchObject({
      status: 409,
      code: 'group_language_taken',
    });
  });

  it('re-embeds only when the title or text changes', async () => {
    const doc = await service.create(ctx, { ...fields, title: 'A', content: 'Some content about the clinic.' });
    store.jobs.length = 0;

    await service.update(ctx, doc.id, { is_published: false });
    expect(store.jobs).toHaveLength(0);
    await service.update(ctx, doc.id, { content: 'Updated content about the clinic.' });
    expect(store.jobs).toHaveLength(1);
    expect(store.docs.get(doc.id).ingest_status).toBe('pending');
  });

  it('stores an upload privately, then reads and embeds it in the background', async () => {
    const file = { originalname: 'Facilities Guide.pdf', size: 1000, buffer: fixture('sample.pdf') };
    const doc = await service.upload(ctx, file, fields);

    expect(doc).toMatchObject({ source_type: 'upload', title: 'Facilities Guide', mime_type: 'application/pdf', content: '' });
    expect(doc.file_path).toBe(`${doc.id}/Facilities_Guide.pdf`);
    expect(store.files.has(doc.file_path)).toBe(true);

    await service.ingestJob({ docId: doc.id, extract: true });
    expect(store.docs.get(doc.id).content).toContain('Wheelchair access');
    expect(ingestDoc).toHaveBeenCalled();
    expect(store.docs.get(doc.id).ingest_status).toBe('ready');
  });

  it('rejects files that are not really PDF/Word/text', async () => {
    const file = { originalname: 'report.pdf', size: 10, buffer: Buffer.from('MZ not a pdf') };
    await expect(service.upload(ctx, file, fields)).rejects.toMatchObject({ status: 422, code: 'unsupported_file' });
    expect(store.files.size).toBe(0);
  });

  it('marks a file with no readable text as failed, with a clear reason', async () => {
    const empty = { originalname: 'scan.txt', size: 5, buffer: Buffer.from('   ') };
    const doc = await service.upload(ctx, empty, { ...fields, group_key: 'scan' });
    await service.ingestJob({ docId: doc.id, extract: true });

    expect(store.docs.get(doc.id)).toMatchObject({ ingest_status: 'failed' });
    expect(store.docs.get(doc.id).ingest_error).toMatch(/No readable text/);
    expect(ingestDoc).not.toHaveBeenCalled();
  });

  it('removes the stored file together with the document', async () => {
    const doc = await service.upload(ctx, { originalname: 'a.docx', size: 10, buffer: fixture('sample.docx') }, fields);
    await service.remove(ctx, doc.id);

    expect(store.docs.has(doc.id)).toBe(false);
    expect(store.removed).toEqual([doc.file_path]);
  });
});
