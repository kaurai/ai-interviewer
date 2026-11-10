import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ResumeSourceKind } from '@ai-interviewer/shared';
import type { ResumeLimits } from '../pipelineConfig';
import { createResumeParsers } from './parsers';
import { ResumeError, type ResumeParser } from './types';

/**
 * Safe resume intake: local path -> allowlisted extension -> size limit ->
 * format adapter -> bounded plain text. The text stays in memory and is
 * handed to the profile extractor; it is never logged or persisted.
 */

export interface ResumeFs {
  stat(file: string): Promise<{ isFile(): boolean; size: number }>;
  readFile(file: string): Promise<Uint8Array>;
}

const nodeFs: ResumeFs = { stat, readFile };

export interface LoadedResume {
  kind: ResumeSourceKind;
  /** Untrusted. Bounded to `maxChars`. Never persist or log. */
  text: string;
  truncated: boolean;
  pageCount: number | null;
  warnings: string[];
}

export interface LoadResumeOptions {
  limits: ResumeLimits;
  parsers?: readonly ResumeParser[];
  fs?: ResumeFs;
  cwd?: string;
}

/** Rejects URLs, UNC shares, and other non-local forms before touching the filesystem. */
export function assertLocalPath(input: string): void {
  const value = input.trim();
  if (value === '') throw new ResumeError('not_found', 'No resume path was given.');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^file:/i.test(value)) {
    throw new ResumeError('not_local_path', 'Resume must be a local file path, not a URL.');
  }
  if (value.startsWith('\\\\') || value.startsWith('//')) {
    throw new ResumeError('not_local_path', 'Resume must be a local file path, not a network share.');
  }
  if (value.includes('\0')) throw new ResumeError('not_local_path', 'Resume path contains an invalid character.');
}

export function allowedResumeExtensions(parsers: readonly ResumeParser[] = createResumeParsers()): string[] {
  return parsers.flatMap((p) => [...p.extensions]);
}

/** Normalize line endings and strip control characters other than newline and tab. */
export function cleanExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

export async function loadResumeFile(inputPath: string, options: LoadResumeOptions): Promise<LoadedResume> {
  const { limits } = options;
  const parsers = options.parsers ?? createResumeParsers();
  const fs = options.fs ?? nodeFs;
  assertLocalPath(inputPath);

  const resolved = path.resolve(options.cwd ?? process.cwd(), inputPath.trim());
  const extension = path.extname(resolved).toLowerCase();
  const parser = parsers.find((p) => p.extensions.includes(extension));
  if (!parser) {
    throw new ResumeError('unsupported_extension', `Resume must be one of: ${allowedResumeExtensions(parsers).join(', ')}.`);
  }

  let info: { isFile(): boolean; size: number };
  try {
    info = await fs.stat(resolved);
  } catch {
    throw new ResumeError('not_found', 'Resume file not found. Check the path and try again.');
  }
  if (!info.isFile()) throw new ResumeError('not_a_file', 'Resume path must point to a regular file.');
  if (info.size === 0) throw new ResumeError('empty', 'The resume file is empty.');
  if (info.size > limits.maxBytes) {
    throw new ResumeError('too_large', `Resume must be at most ${(limits.maxBytes / (1024 * 1024)).toFixed(1)} MB.`);
  }

  const data = await fs.readFile(resolved);
  // Re-check: the file could have changed between stat and read.
  if (data.byteLength > limits.maxBytes) throw new ResumeError('too_large', 'Resume grew beyond the size limit while reading.');

  const extracted = await parser.parse(data, limits);
  const cleaned = cleanExtractedText(extracted.text);
  if (cleaned.trim() === '') {
    const hint = parser.kind === 'pdf' ? ' It may be a scanned image; export a text-based PDF or use .txt/.md.' : '';
    throw new ResumeError('empty', `No readable text was found in the resume.${hint}`);
  }
  const truncated = cleaned.length > limits.maxChars;
  const warnings = [...extracted.warnings];
  if (truncated) warnings.push(`Only the first ${limits.maxChars} characters were analyzed.`);
  return {
    kind: parser.kind,
    text: truncated ? cleaned.slice(0, limits.maxChars) : cleaned,
    truncated,
    pageCount: extracted.pageCount,
    warnings,
  };
}
