import type { ResumeSourceKind } from '@ai-interviewer/shared';
import type { ResumeLimits } from '../pipelineConfig';

/**
 * Resume parsing boundary.
 *
 * A ResumeParser turns validated bytes into plain text. It never sees a path,
 * never logs content, and never interprets the text. Everything downstream
 * (profile extraction) treats that text as untrusted data.
 */

export const RESUME_ERROR_CODES = [
  'not_local_path',
  'not_found',
  'not_a_file',
  'unsupported_extension',
  'too_large',
  'empty',
  'encrypted',
  'corrupt',
  'too_many_pages',
  'parser_unavailable',
] as const;
export type ResumeErrorCode = (typeof RESUME_ERROR_CODES)[number];

/** Safe, user-facing messages. They never include file content or the full path. */
export class ResumeError extends Error {
  override readonly name = 'ResumeError';

  constructor(
    readonly code: ResumeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ExtractedText {
  text: string;
  /** Pages in the source document, when the format has pages. */
  pageCount: number | null;
  /** Non-fatal notes such as "only the first 10 pages were read". */
  warnings: string[];
}

export interface ResumeParser {
  readonly kind: ResumeSourceKind;
  /** Lowercase extensions including the dot, e.g. `.pdf`. */
  readonly extensions: readonly string[];
  parse(data: Uint8Array, limits: ResumeLimits): Promise<ExtractedText>;
  /** Can this parser run here (library installed)? Local check only. */
  checkReadiness(): Promise<{ ready: boolean; detail: string }>;
}

/**
 * Loads an optional library by name. Injected so tests can supply fakes and
 * so the app still runs (text resumes only) before `npm install` adds them.
 */
export type ModuleLoader = (name: string) => Promise<unknown>;

export const importModule: ModuleLoader = async (name) => {
  // A non-literal specifier keeps optional libraries out of static resolution.
  const specifier: string = name;
  return import(specifier);
};
