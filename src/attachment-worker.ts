/**
 * Worker thread that turns document attachments into text. Runs isolated with memory and time
 * limits (see attachment-text.ts), so malformed or hostile files cannot take the server down.
 */

import { parentPort, workerData } from 'node:worker_threads';

export type DocumentKind = 'pdf' | 'docx' | 'spreadsheet';

export interface WorkerInput {
  kind: DocumentKind;
  data: Uint8Array;
}

export type WorkerOutput = { text: string } | { error: string };

async function pdfToText(data: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(data);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  if (text.every((page) => page.trim() === '')) {
    return `(The PDF has ${totalPages} page(s) but no text layer; it is probably scanned. Text recognition is not available.)`;
  }
  return text.map((page, index) => `--- Page ${index + 1} of ${totalPages} ---\n${page.trim()}`).join('\n\n');
}

async function docxToText(data: Uint8Array): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.default.extractRawText({ buffer: Buffer.from(data) });
  return result.value.replace(/\n{3,}/g, '\n\n').trim();
}

async function spreadsheetToText(data: Uint8Array): Promise<string> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });
  return workbook.SheetNames.map((name) => {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false });
    return `--- Sheet: ${name} ---\n${csv.trim() || '(empty)'}`;
  }).join('\n\n');
}

const converters: Record<DocumentKind, (data: Uint8Array) => Promise<string>> = {
  pdf: pdfToText,
  docx: docxToText,
  spreadsheet: spreadsheetToText,
};

const input = workerData as WorkerInput;
converters[input.kind](input.data)
  .then((text) => parentPort!.postMessage({ text } satisfies WorkerOutput))
  .catch((error) => parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies WorkerOutput));
