import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { InterviewSessionSchema, SESSION_ID_PATTERN, type InterviewSession } from '@ai-interviewer/shared';

/**
 * Session persistence (CONTEXT.md 5.3, 12.3).
 *
 * - IDs are generated (`iv_` + 24 hex) and validated before any path is
 *   built, so a crafted ID cannot traverse out of the sessions directory.
 * - Writes are atomic: write a private temp file, then rename over the target.
 * - Writes for one session run through a queue, so updates never interleave.
 * - Only schema-valid sessions are written. Sessions hold the corrected
 *   transcript and derived professional signals; never raw resumes or audio.
 */

export class InvalidSessionIdError extends Error {
  override readonly name = 'InvalidSessionIdError';
  constructor() {
    super('Invalid session ID. IDs look like iv_ followed by 24 hex characters.');
  }
}

export class SessionNotFoundError extends Error {
  override readonly name = 'SessionNotFoundError';
  constructor(readonly sessionId: string) {
    super(`Session ${sessionId} was not found.`);
  }
}

export interface ReportFiles {
  json: string;
  markdown: string;
}

export interface SessionStore {
  /** False for the in-memory store used by --no-save. */
  readonly persistent: boolean;
  save(session: InterviewSession): Promise<void>;
  load(id: string): Promise<InterviewSession>;
  /** Removes the session and its reports. Returns false when nothing existed. */
  delete(id: string): Promise<boolean>;
  saveReports(id: string, reports: ReportFiles): Promise<{ jsonPath: string; markdownPath: string } | null>;
  list(): Promise<string[]>;
}

export function newSessionId(): string {
  return `iv_${randomBytes(12).toString('hex')}`;
}

export function assertSessionId(id: string): void {
  if (typeof id !== 'string' || !SESSION_ID_PATTERN.test(id)) throw new InvalidSessionIdError();
}

const SUFFIXES = { session: '.json', reportJson: '.report.json', reportMarkdown: '.report.md' } as const;

/** Serializes async work per key; a failed task does not block later ones. */
export function createKeyedQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}

export function createFileSessionStore(directory: string): SessionStore {
  const root = path.resolve(directory);
  const enqueue = createKeyedQueue();

  const fileFor = (id: string, suffix: string): string => {
    assertSessionId(id);
    const file = path.join(root, `${id}${suffix}`);
    // Defense in depth: the validated ID cannot contain separators, but check anyway.
    if (path.dirname(file) !== root) throw new InvalidSessionIdError();
    return file;
  };

  async function atomicWrite(target: string, content: string): Promise<void> {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const temp = path.join(root, `.${path.basename(target)}.${randomBytes(6).toString('hex')}.tmp`);
    try {
      await writeFile(temp, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  return {
    persistent: true,
    async save(session) {
      const valid = InterviewSessionSchema.parse(session);
      const file = fileFor(valid.id, SUFFIXES.session);
      return enqueue(valid.id, () => atomicWrite(file, `${JSON.stringify(valid, null, 2)}\n`));
    },
    async load(id) {
      const file = fileFor(id, SUFFIXES.session);
      let text: string;
      try {
        text = await readFile(file, 'utf8');
      } catch {
        throw new SessionNotFoundError(id);
      }
      return InterviewSessionSchema.parse(JSON.parse(text));
    },
    async delete(id) {
      const files = Object.values(SUFFIXES).map((suffix) => fileFor(id, suffix));
      return enqueue(id, async () => {
        let removed = false;
        for (const file of files) {
          try {
            await rm(file);
            removed = true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
        return removed;
      });
    },
    async saveReports(id, reports) {
      const jsonPath = fileFor(id, SUFFIXES.reportJson);
      const markdownPath = fileFor(id, SUFFIXES.reportMarkdown);
      return enqueue(id, async () => {
        await atomicWrite(jsonPath, reports.json);
        await atomicWrite(markdownPath, reports.markdown);
        return { jsonPath, markdownPath };
      });
    },
    async list() {
      let names: string[];
      try {
        names = await readdir(root);
      } catch {
        return [];
      }
      return names
        .filter((n) => n.endsWith(SUFFIXES.session) && !n.endsWith(SUFFIXES.reportJson))
        .map((n) => n.slice(0, -SUFFIXES.session.length))
        .filter((id) => SESSION_ID_PATTERN.test(id))
        .sort();
    },
  };
}

/** --no-save: nothing touches the disk. Copies keep callers from sharing state. */
export function createMemorySessionStore(): SessionStore {
  const sessions = new Map<string, InterviewSession>();
  return {
    persistent: false,
    async save(session) {
      const valid = InterviewSessionSchema.parse(session);
      sessions.set(valid.id, structuredClone(valid));
    },
    async load(id) {
      assertSessionId(id);
      const found = sessions.get(id);
      if (!found) throw new SessionNotFoundError(id);
      return structuredClone(found);
    },
    async delete(id) {
      assertSessionId(id);
      return sessions.delete(id);
    },
    async saveReports() {
      return null;
    },
    async list() {
      return [...sessions.keys()].sort();
    },
  };
}
