import { ResumeError, importModule, type ExtractedText, type ModuleLoader, type ResumeParser } from './types';

/**
 * Format adapters. Each one validates the file signature before handing bytes
 * to a maintained library, and maps library failures to a ResumeError code.
 * Library error messages are never shown: they can contain document text.
 */

function startsWith(data: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  return bytes.every((b, i) => data[offset + i] === b);
}

// --- .txt / .md ------------------------------------------------------------------

export function createTextResumeParser(kind: 'text' | 'markdown'): ResumeParser {
  return {
    kind,
    extensions: kind === 'text' ? ['.txt'] : ['.md', '.markdown'],
    async parse(data) {
      if (data.includes(0)) throw new ResumeError('corrupt', 'The file contains binary data; save the resume as plain UTF-8 text.');
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(data);
      } catch {
        throw new ResumeError('corrupt', 'The file is not valid UTF-8 text.');
      }
      return { text, pageCount: null, warnings: [] };
    },
    async checkReadiness() {
      return { ready: true, detail: 'built in' };
    },
  };
}

// --- PDF (pdf-parse v2) -----------------------------------------------------------

/** The subset of the pdf-parse v2 API this adapter uses. */
interface PdfTextResult {
  text: string;
  total?: number;
}
interface PdfParseInstance {
  getText(params?: { first?: number }): Promise<PdfTextResult>;
  destroy(): Promise<void> | void;
}
interface PdfParseModule {
  PDFParse: new (options: { data: Uint8Array }) => PdfParseInstance;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

function hasPdfHeader(data: Uint8Array): boolean {
  // The spec allows leading bytes before the header; real files put it first.
  const window = Math.min(data.length - PDF_MAGIC.length, 1024);
  for (let i = 0; i <= window; i += 1) if (startsWith(data, PDF_MAGIC, i)) return true;
  return false;
}

export function mapPdfError(error: unknown): ResumeError {
  if (error instanceof ResumeError) return error;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'PasswordException' || /password|encrypt/i.test(message)) {
    return new ResumeError('encrypted', 'The PDF is password-protected. Export an unprotected copy or a .txt/.md resume.');
  }
  return new ResumeError('corrupt', 'The PDF could not be read. It may be damaged; try exporting it again or use .txt/.md.');
}

export function createPdfResumeParser(deps: { loadModule?: ModuleLoader } = {}): ResumeParser {
  const loadModule = deps.loadModule ?? importModule;
  const load = async (): Promise<PdfParseModule> => {
    try {
      const mod = (await loadModule('pdf-parse')) as Partial<PdfParseModule> & { default?: Partial<PdfParseModule> };
      const PDFParse = mod.PDFParse ?? mod.default?.PDFParse;
      if (typeof PDFParse !== 'function') throw new Error('PDFParse export missing');
      return { PDFParse };
    } catch {
      throw new ResumeError('parser_unavailable', 'PDF support needs the pdf-parse package. Run npm install, or use a .txt/.md resume.');
    }
  };

  return {
    kind: 'pdf',
    extensions: ['.pdf'],
    async parse(data, limits): Promise<ExtractedText> {
      if (!hasPdfHeader(data)) throw new ResumeError('corrupt', 'The file has a .pdf extension but is not a PDF.');
      const { PDFParse } = await load();
      // Copy: pdf.js may transfer (detach) the buffer it receives.
      let parser: PdfParseInstance | undefined;
      try {
        parser = new PDFParse({ data: new Uint8Array(data) });
        const result = await parser.getText({ first: limits.maxPdfPages });
        const total = typeof result.total === 'number' ? result.total : null;
        if (total !== null && total > limits.maxPdfPages * 4) {
          throw new ResumeError('too_many_pages', `The PDF has ${total} pages; a resume should be at most ${limits.maxPdfPages}.`);
        }
        const warnings = total !== null && total > limits.maxPdfPages ? [`Only the first ${limits.maxPdfPages} of ${total} pages were read.`] : [];
        return { text: typeof result.text === 'string' ? result.text : '', pageCount: total, warnings };
      } catch (error) {
        throw mapPdfError(error);
      } finally {
        // Always release pdf.js resources, even after a failure.
        if (parser) await Promise.resolve(parser.destroy()).catch(() => undefined);
      }
    },
    async checkReadiness() {
      try {
        await load();
        return { ready: true, detail: 'pdf-parse installed' };
      } catch {
        return { ready: false, detail: 'pdf-parse not installed (run npm install); .txt/.md resumes still work' };
      }
    },
  };
}

// --- DOCX (mammoth) ---------------------------------------------------------------

interface MammothModule {
  extractRawText(input: { buffer: Buffer }): Promise<{ value: string; messages: unknown[] }>;
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
/** OLE compound file: password-protected Office documents (and legacy .doc). */
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function createDocxResumeParser(deps: { loadModule?: ModuleLoader } = {}): ResumeParser {
  const loadModule = deps.loadModule ?? importModule;
  const load = async (): Promise<MammothModule> => {
    try {
      const mod = (await loadModule('mammoth')) as Partial<MammothModule> & { default?: Partial<MammothModule> };
      const extractRawText = mod.extractRawText ?? mod.default?.extractRawText;
      if (typeof extractRawText !== 'function') throw new Error('extractRawText export missing');
      return { extractRawText };
    } catch {
      throw new ResumeError('parser_unavailable', 'DOCX support needs the mammoth package. Run npm install, or use a .txt/.md resume.');
    }
  };

  return {
    kind: 'docx',
    extensions: ['.docx'],
    async parse(data): Promise<ExtractedText> {
      if (startsWith(data, CFB_MAGIC)) {
        throw new ResumeError('encrypted', 'The DOCX is password-protected (or is a legacy .doc). Save an unprotected .docx, .txt, or .md copy.');
      }
      if (!startsWith(data, ZIP_MAGIC)) throw new ResumeError('corrupt', 'The file has a .docx extension but is not a DOCX document.');
      const { extractRawText } = await load();
      try {
        // `messages` are style-conversion notes; they are intentionally discarded, not logged.
        const result = await extractRawText({ buffer: Buffer.from(data) });
        return { text: typeof result.value === 'string' ? result.value : '', pageCount: null, warnings: [] };
      } catch {
        throw new ResumeError('corrupt', 'The DOCX could not be read. It may be damaged; try saving it again or use .txt/.md.');
      }
    },
    async checkReadiness() {
      try {
        await load();
        return { ready: true, detail: 'mammoth installed' };
      } catch {
        return { ready: false, detail: 'mammoth not installed (run npm install); .txt/.md resumes still work' };
      }
    },
  };
}

export function createResumeParsers(deps: { loadModule?: ModuleLoader } = {}): ResumeParser[] {
  return [createTextResumeParser('text'), createTextResumeParser('markdown'), createPdfResumeParser(deps), createDocxResumeParser(deps)];
}
