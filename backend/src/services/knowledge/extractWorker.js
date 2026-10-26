import { parentPort, workerData } from 'node:worker_threads';

/**
 * Runs in a separate thread: turns an uploaded file into plain text.
 * (Parsing a big PDF keeps the processor busy; doing it here keeps chats responsive.)
 */
async function pdfText(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // isEvalSupported:false — never compile code from a PDF's fonts (defence against malicious files).
  // verbosity 0: errors only (we read text, never draw fonts, so font warnings don't matter).
  const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 })
    .promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    let line = '';
    const lines = [];
    for (const item of content.items) {
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = '';
      } else if (item.str && !item.str.endsWith(' ')) {
        line += ' ';
      }
    }
    if (line.trim()) lines.push(line);
    pages.push(lines.join('\n'));
  }
  await pdf.destroy();
  return pages.join('\n\n');
}

async function docxText(bytes) {
  const mammoth = (await import('mammoth')).default;
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return value;
}

try {
  const { kind, bytes } = workerData;
  let text;
  if (kind === 'pdf') text = await pdfText(bytes);
  else if (kind === 'docx') text = await docxText(bytes);
  else text = Buffer.from(bytes).toString('utf8');
  parentPort.postMessage({ text });
} catch (err) {
  parentPort.postMessage({ error: err.message });
}
