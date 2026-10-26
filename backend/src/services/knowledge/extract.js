import { Worker } from 'node:worker_threads';

/**
 * Knowledge files: which kinds we accept, and getting their text out.
 *
 * The kind is decided from the file's own first bytes AND its name — never from the
 * browser's claimed type alone (a renamed .exe stays rejected).
 */
export const KINDS = Object.freeze({
  pdf: { mime: 'application/pdf', ext: ['.pdf'] },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: ['.docx'] },
  txt: { mime: 'text/plain', ext: ['.txt'] },
  md: { mime: 'text/markdown', ext: ['.md', '.markdown'] },
});

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // the storage bucket's limit
export const MAX_TEXT_CHARS = 200_000;

/** 'pdf' | 'docx' | 'txt' | 'md' | null */
export function detectKind(fileName, bytes) {
  const name = String(fileName ?? '').toLowerCase();
  const kind = Object.keys(KINDS).find((k) => KINDS[k].ext.some((ext) => name.endsWith(ext)));
  if (!kind) return null;
  const head = Buffer.from(bytes.subarray(0, 4));
  if (kind === 'pdf') return head.toString('latin1') === '%PDF' ? 'pdf' : null;
  if (kind === 'docx') return head[0] === 0x50 && head[1] === 0x4b ? 'docx' : null; // "PK" = zip container
  // Text files must really be text: no NUL bytes in the first 8 KB.
  return bytes.subarray(0, 8192).includes(0) ? null : kind;
}

/** Tidies extracted text: normal line breaks, no runs of blank lines or spaces, capped length. */
export function cleanText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

/** Extracts text in a worker thread, with a time limit (a broken file can't hang the server). */
export function extractText(kind, bytes, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./extractWorker.js', import.meta.url), {
      workerData: { kind, bytes: new Uint8Array(bytes) },
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Reading the file took too long'));
    }, timeoutMs);
    worker.once('message', (message) => {
      clearTimeout(timer);
      worker.terminate();
      if (message.error) reject(new Error(`Could not read the file: ${message.error}`));
      else resolve(cleanText(message.text));
    });
    worker.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
