import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFileSessionStore } from '../../src/data/sessionStore';

describe('file session store', () => {
  it('rejects path traversal IDs before accessing storage', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'ai-interviewer-store-'));
    const store = createFileSessionStore(directory);
    await expect(store.load('../../secret')).rejects.toThrow('Invalid session ID');
    await expect(store.delete('not-an-id')).rejects.toThrow('Invalid session ID');
  });
});
