import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMemorySessionStore } from '../../api/src/data/sessionStore';
import { parseCliArgs, runCli } from '../src/runner';

const root = path.resolve(import.meta.dirname, '../../..');

describe('interview CLI', () => {
  it('parses workshop flags', () => {
    const options = parseCliArgs(['--role', 'backend', '--seniority', 'mid', '--questions', '3', '--no-save', '--yes']);
    expect(options).toMatchObject({ role: 'backend', seniority: 'mid', questions: 3, noSave: true, yes: true });
  });

  it('runs a scripted interview through evaluation without persistence or network calls', async () => {
    const lines: string[] = [];
    const result = await runCli(parseCliArgs([
      '--resume', path.join(root, 'data/fixtures/synthetic-backend-resume.md'),
      '--role', 'backend', '--seniority', 'mid', '--mode', 'text', '--questions', '3',
      '--answers', path.join(root, 'data/fixtures/demo-answers.json'), '--no-save', '--yes',
    ]), {
      store: createMemorySessionStore(),
      console: { log: (message = '') => lines.push(String(message)), error: (message = '') => lines.push(String(message)) },
      speech: { id: 'none', speak: async () => {}, checkReadiness: async () => ({ ready: true, detail: 'test' }) },
    });
    expect(result.exitCode).toBe(0);
    expect(result.session?.status).toBe('completed');
    expect(result.session?.askedQuestionIds).toHaveLength(3);
    expect(lines.join('\n')).toContain('# AI Interview Practice Report');
  });
});
