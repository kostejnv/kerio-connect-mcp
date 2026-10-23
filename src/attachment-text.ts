/**
 * Converts downloaded attachments into something an agent can read: text for documents,
 * the image itself for pictures. Document parsing runs in a worker with resource limits.
 */

import { Worker } from 'node:worker_threads';
import { htmlToText } from './html-to-text.js';
import type { DocumentKind, WorkerOutput } from './attachment-worker.js';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** Larger images are rejected by common MCP clients. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const WORKER_TIMEOUT_MS = 30_000;
const WORKER_MEMORY_MB = 256;

export type AttachmentKind = DocumentKind | 'text' | 'html' | 'image' | 'unsupported';

const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
};

export const SUPPORTED_FORMATS = 'PDF, Word (DOCX), Excel/OpenDocument spreadsheets (XLSX, XLSM, XLS, ODS), CSV, plain text, HTML, calendar (ICS), e-mail (EML), and images (JPG, PNG, GIF, WebP)';

export function classifyAttachment(name: string | undefined, contentType: string | undefined): AttachmentKind {
  const extension = (name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const type = (contentType ?? '').toLowerCase().split(';')[0].trim();

  if (extension === 'pdf' || type === 'application/pdf') return 'pdf';
  if (extension === 'docx' || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (['xlsx', 'xlsm', 'xls', 'ods'].includes(extension) ||
      type.includes('spreadsheetml') || type === 'application/vnd.ms-excel' || type === 'application/vnd.oasis.opendocument.spreadsheet') {
    return 'spreadsheet';
  }
  if (['htm', 'html'].includes(extension) || type === 'text/html') return 'html';
  if (['txt', 'csv', 'tsv', 'ics', 'eml', 'xml', 'json', 'md', 'log'].includes(extension) ||
      type.startsWith('text/') || type === 'message/rfc822') {
    return 'text';
  }
  if (IMAGE_TYPES[extension] || Object.values(IMAGE_TYPES).includes(type)) return 'image';
  return 'unsupported';
}

export function imageMimeType(name: string | undefined, contentType: string | undefined): string {
  const type = (contentType ?? '').toLowerCase().split(';')[0].trim();
  if (Object.values(IMAGE_TYPES).includes(type)) return type;
  const extension = (name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  return IMAGE_TYPES[extension] ?? 'image/png';
}

function decodeText(data: Buffer, contentType: string | undefined): string {
  const charset = (contentType ?? '').match(/charset="?([^";\s]+)/i)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(data);
  } catch {
    return new TextDecoder('utf-8').decode(data);
  }
}

function workerUrl(): { url: URL; execArgv: string[] } {
  // Explicit execArgv: the worker must not inherit the parent's flags. Running from TypeScript
  // sources (npm run dev) needs the tsx loader in the worker too.
  return import.meta.url.endsWith('.ts')
    ? { url: new URL('./attachment-worker.ts', import.meta.url), execArgv: ['--import', 'tsx'] }
    : { url: new URL('./attachment-worker.js', import.meta.url), execArgv: [] };
}

function convertInWorker(kind: DocumentKind, data: Buffer): Promise<string> {
  const { url, execArgv } = workerUrl();
  return new Promise((resolve, reject) => {
    const worker = new Worker(url, {
      workerData: { kind, data: new Uint8Array(data) },
      execArgv,
      resourceLimits: { maxOldGenerationSizeMb: WORKER_MEMORY_MB },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`Reading the attachment took longer than ${WORKER_TIMEOUT_MS / 1000} seconds`));
    }, WORKER_TIMEOUT_MS);

    worker.once('message', (output: WorkerOutput) => {
      clearTimeout(timer);
      void worker.terminate();
      if ('text' in output) resolve(output.text);
      else reject(new Error(`The attachment could not be read: ${output.error}`));
    });
    worker.once('error', (error: Error) => {
      clearTimeout(timer);
      reject(new Error(`The attachment could not be read: ${error.message}`));
    });
  });
}

/** Text content of a text-like attachment (everything except images and unsupported formats). */
export async function attachmentToText(kind: AttachmentKind, data: Buffer, contentType: string | undefined): Promise<string> {
  switch (kind) {
    case 'pdf':
    case 'docx':
    case 'spreadsheet':
      return convertInWorker(kind, data);
    case 'html':
      return htmlToText(decodeText(data, contentType));
    case 'text':
      return decodeText(data, contentType);
    default:
      throw new Error(`No text conversion for ${kind} attachments`);
  }
}
