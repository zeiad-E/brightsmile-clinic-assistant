import multer from 'multer';
import { MAX_FILE_BYTES } from '../services/knowledge/extract.js';

/**
 * Accepts ONE file (field "file") up to 10 MB, kept in memory — it goes straight to private
 * storage and never touches the server's disk. The file's real type is checked later from
 * its content (see services/knowledge/extract.js), not trusted from the browser.
 */
export function fileUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 10, fieldSize: 2000 },
  }).single('file');
}
