import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { Store } from '../src/index.js';
describe('SQLite durable boundary', () => {
  it('recovers uncertain execution, preserves one logical task, commits inbox/outbox and rolls back failures', () => {
    const root = mkdtempSync(join(tmpdir(), 'lam-store ')),
      file = join(root, 'state.sqlite');
    let db = new Store(file);
    try {
      db.put('sessions', 's', { nativeSessionId: 'native' });
      expect(db.acceptTask('t', 'peer', 'key', { sessionId: 's' }).fresh).toBe(true);
      db.event('t', 'RUNNING', { type: 'started' });
      db.enqueue('m', 'peer', { hello: 1 });
      db.receipt('in', 'peer', { hello: 2 }, { ok: true });
      expect(() =>
        db.transaction(() => {
          db.put('agents', 'bad', {});
          throw new Error('rollback');
        }),
      ).toThrow('rollback');
      expect(db.get('agents', 'bad')).toBeUndefined();
      db.close();
      db = new Store(file);
      expect(db.get('sessions', 's')).toEqual({ nativeSessionId: 'native' });
      expect(db.recover()).toEqual(['t']);
      expect(db.task('t')?.state).toBe('UNKNOWN');
      expect(db.acceptTask('t', 'peer', 'key', { sessionId: 's' }).fresh).toBe(false);
      expect(() => db.acceptTask('other', 'peer', 'key', { sessionId: 's' })).toThrowError(
        expect.objectContaining({ code: 'conflict' }),
      );
      expect(db.count('tasks')).toBe(1);
      expect(db.inbox('in', 'peer', { hello: 2 })).toEqual({ ok: true });
      expect(() => db.inbox('in', 'attacker', { hello: 2 })).toThrow();
      expect(db.pending()).toHaveLength(1);
      db.ack('m');
      expect(db.pending()).toEqual([]);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
