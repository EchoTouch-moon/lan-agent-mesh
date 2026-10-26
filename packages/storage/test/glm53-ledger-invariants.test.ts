// GLM-5.3 G-R1 (#75): deterministic bounded state-sequence regression for the durable
// SQLite ledger. Enumerates accept/idempotency/conflict sequences, restart recovery,
// inbox/outbox retention bounds and transaction atomicity. Test-only; no production change.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store, type TaskStatus } from '../src/index.js';

const input = (overrides: Record<string, unknown> = {}) => ({
  sessionId: 'sess-1',
  text: 'fixture payload',
  workspaceAlias: 'project-a',
  deadline: '2026-10-26T12:00:00.000Z',
  ...overrides,
});
const auditKinds = (store: Store) =>
  store.query('SELECT kind FROM audit_events ORDER BY id').map((r) => String(r.kind));

describe('glm53 task ledger idempotency and conflict matrix', () => {
  it.each([
    ['changed input text', input({ text: 'changed' })],
    ['changed deadline', input({ deadline: '2026-10-26T12:00:01.000Z' })],
    ['changed session scope', input({ sessionId: 'sess-2' })],
  ] as const)('keeps exactly one logical task per (peer,key) and rejects %s', (label, changed) => {
    const store = new Store(':memory:');
    try {
      const first = store.acceptTask('task-1', 'peer-a', 'key-1', input());
      expect(first.fresh).toBe(true);
      expect(first.task.state).toBe('QUEUED');
      const replay = store.acceptTask('task-1', 'peer-a', 'key-1', input());
      expect(replay.fresh).toBe(false);
      expect(replay.task.id).toBe('task-1');
      expect(store.count('tasks')).toBe(1);
      expect(() => store.acceptTask('task-1', 'peer-a', 'key-1', changed)).toThrowError(
        expect.objectContaining({ code: 'conflict' }),
      );
      expect(store.count('tasks'), label).toBe(1);
    } finally {
      store.close();
    }
  });

  it('rejects a different task id and a reused task id while keeping the original row intact', () => {
    const store = new Store(':memory:');
    try {
      store.acceptTask('task-1', 'peer-a', 'key-1', input());
      expect(() => store.acceptTask('task-2', 'peer-a', 'key-1', input())).toThrowError(
        expect.objectContaining({ code: 'conflict' }),
      );
      expect(() => store.acceptTask('task-1', 'peer-a', 'key-2', input())).toThrowError(
        expect.objectContaining({ code: 'conflict' }),
      );
      expect(store.task('task-1')?.key).toBe('key-1');
      expect(store.count('tasks')).toBe(1);
    } finally {
      store.close();
    }
  });

  it('namespaces the same key per peer: a foreign peer gets its own logical task, never the original', () => {
    const store = new Store(':memory:');
    try {
      store.acceptTask('task-a', 'peer-a', 'key-shared', input());
      const foreign = store.acceptTask('task-b', 'peer-b', 'key-shared', input());
      expect(foreign.fresh).toBe(true);
      expect(store.count('tasks')).toBe(2);
      expect(store.task('task-a')?.peer).toBe('peer-a');
      expect(store.task('task-b')?.peer).toBe('peer-b');
    } finally {
      store.close();
    }
  });

  it('audits one task.accepted row per fresh accept and none for deduplicated replays', () => {
    const store = new Store(':memory:');
    try {
      store.acceptTask('task-1', 'peer-a', 'key-1', input());
      store.acceptTask('task-1', 'peer-a', 'key-1', input());
      store.acceptTask('task-1', 'peer-a', 'key-1', input());
      expect(auditKinds(store).filter((k) => k === 'task.accepted')).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it('enforces the caller-supplied task capacity limit before inserting', () => {
    const store = new Store(':memory:');
    try {
      for (let i = 0; i < 3; i++) store.acceptTask(`task-${i}`, 'peer-a', `key-${i}`, input());
      expect(() => store.acceptTask('task-3', 'peer-a', 'key-3', input(), 3)).toThrowError(
        expect.objectContaining({ code: 'busy' }),
      );
      expect(store.count('tasks')).toBe(3);
    } finally {
      store.close();
    }
  });

  it('rolls back its own transaction when the insert fails, leaving the ledger usable with no residue', () => {
    const store = new Store(':memory:');
    try {
      // acceptTask wraps itself in one transaction and cannot be nested in an outer one
      // ("cannot start a transaction within a transaction"), so the reachable atomicity
      // failure is an unserializable payload: the INSERT throws before any row or audit exists.
      expect(() => store.acceptTask('task-1', 'peer-a', 'key-1', undefined)).toThrow(TypeError);
      expect(store.task('task-1')).toBeUndefined();
      expect(store.count('tasks')).toBe(0);
      expect(store.count('audit_events')).toBe(0);
      const retry = store.acceptTask('task-1', 'peer-a', 'key-1', input());
      expect(retry.fresh).toBe(true);
      expect(store.count('tasks')).toBe(1);
    } finally {
      store.close();
    }
  });
});

describe('glm53 durable recovery: restart converts only uncertain states to UNKNOWN', () => {
  const uncertain: TaskStatus[] = ['QUEUED', 'RUNNING', 'WAITING_INPUT'];
  const settled: TaskStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN'];
  const seed = (store: Store, state: TaskStatus) => {
    store.acceptTask(`task-${state}`, 'peer-a', `key-${state}`, input());
    store.event(`task-${state}`, state, { type: 'reached', state });
  };

  it.each(uncertain)('recovers %s to UNKNOWN exactly once with a durable marker event', async state => {
    const root = mkdtempSync(join(tmpdir(), 'lam-glm53-recover-')), file = join(root, 'state.sqlite');
    let store = new Store(file);
    try {
      seed(store, state);
      store.close();
      store = new Store(file);
      expect(store.recover()).toEqual([`task-${state}`]);
      const task = store.task(`task-${state}`)!;
      expect(task.state).toBe('UNKNOWN');
      expect(task.events.at(-1)).toMatchObject({ type: 'unknown' });
      expect(auditKinds(store)).toContain('task.recovered_unknown');
      expect(store.recover()).toEqual([]);
      expect(store.task(`task-${state}`)!.events).toHaveLength(task.events.length);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(settled)('leaves %s untouched by recovery and never re-executes or completes it', state => {
    const root = mkdtempSync(join(tmpdir(), 'lam-glm53-settled-')), file = join(root, 'state.sqlite');
    let store = new Store(file);
    try {
      seed(store, state);
      const before = store.task(`task-${state}`)!;
      store.close();
      store = new Store(file);
      expect(store.recover()).toEqual([]);
      expect(store.task(`task-${state}`)).toEqual(before);
      expect(auditKinds(store)).not.toContain('task.recovered_unknown');
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('still deduplicates the original request after restart-UNKNOWN: one logical task forever', () => {
    const root = mkdtempSync(join(tmpdir(), 'lam-glm53-dedupe-')), file = join(root, 'state.sqlite');
    let store = new Store(file);
    try {
      seed(store, 'RUNNING');
      store.close();
      store = new Store(file);
      store.recover();
      const replay = store.acceptTask('task-RUNNING', 'peer-a', 'key-RUNNING', input());
      expect(replay.fresh).toBe(false);
      expect(replay.task.state).toBe('UNKNOWN');
      expect(() => store.acceptTask('task-RUNNING', 'peer-a', 'key-RUNNING', input({ text: 'changed' }))).toThrowError(
        expect.objectContaining({ code: 'conflict' }),
      );
      expect(store.count('tasks')).toBe(1);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves the pre-crash event order across reopen and recovery', () => {
    const root = mkdtempSync(join(tmpdir(), 'lam-glm53-events-')), file = join(root, 'state.sqlite');
    let store = new Store(file);
    try {
      store.acceptTask('task-1', 'peer-a', 'key-1', input());
      store.event('task-1', 'RUNNING', { type: 'started' });
      store.event('task-1', 'WAITING_INPUT', { type: 'permission' });
      store.close();
      store = new Store(file);
      expect(store.recover()).toEqual(['task-1']);
      const events = store.task('task-1')!.events;
      expect(events.map((e) => (e as { type: string }).type)).toEqual([
        'started', 'permission', 'unknown',
      ]);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('glm53 event budget and missing-task failures', () => {
  it('bounds the durable event log at 4096 entries and keeps the last committed state', () => {
    const store = new Store(':memory:');
    try {
      store.acceptTask('task-1', 'peer-a', 'key-1', input());
      for (let i = 0; i < 4096; i++) store.event('task-1', 'RUNNING', { i });
      expect(store.task('task-1')!.events).toHaveLength(4096);
      expect(() => store.event('task-1', 'COMPLETED', { i: 4096 })).toThrowError(
        expect.objectContaining({ code: 'busy' }),
      );
      const task = store.task('task-1')!;
      expect(task.events).toHaveLength(4096);
      expect(task.state).toBe('RUNNING');
    } finally {
      store.close();
    }
  });

  it('fails closed with not_found when an event targets an unknown task', () => {
    const store = new Store(':memory:');
    try {
      expect(() => store.event('missing', 'RUNNING', {})).toThrowError(
        expect.objectContaining({ code: 'not_found' }),
      );
    } finally {
      store.close();
    }
  });
});

describe('glm53 inbox/outbox ledger: lost ACK, cross-peer isolation and retention bounds', () => {
  it('replays the exact recorded response and rejects a changed request or foreign peer', () => {
    const store = new Store(':memory:');
    try {
      store.receipt('msg-1', 'peer-a', { hello: 1 }, { ok: true });
      expect(store.inbox('msg-1', 'peer-a', { hello: 1 })).toEqual({ ok: true });
      expect(() => store.inbox('msg-1', 'peer-a', { hello: 2 })).toThrowError(
        expect.objectContaining({ code: 'conflict' }),
      );
      expect(() => store.inbox('msg-1', 'peer-b', { hello: 1 })).toThrowError(
        expect.objectContaining({ code: 'conflict' }),
      );
      expect(store.inbox('msg-2', 'peer-a', { hello: 1 })).toBeUndefined();
    } finally {
      store.close();
    }
  });

  it('maps duplicate receipt writes to semantic conflict and keeps the original row authoritative (#86)', () => {
    const store = new Store(':memory:');
    try {
      store.receipt('msg-1', 'peer-a', { hello: 1 }, { ok: true });
      // A foreign peer reusing the message id gets a bounded conflict, never a raw SQLite
      // constraint error (F1 in docs/security/glm53/recovery-results.md; fixed per #86).
      expect(() => store.receipt('msg-1', 'peer-b', { hello: 2 }, { forged: true })).toThrowError(
        expect.objectContaining({ code: 'conflict' }),
      );
      // Same peer with a changed request fingerprint is likewise a conflict, not an overwrite.
      expect(() => store.receipt('msg-1', 'peer-a', { hello: 2 }, { forged: true })).toThrowError(
        expect.objectContaining({ code: 'conflict' }),
      );
      // Same peer re-receipting the identical request is an idempotent no-op: the original
      // response stays authoritative even if a second response value is supplied.
      store.receipt('msg-1', 'peer-a', { hello: 1 }, { ok: true, duplicate: true });
      expect(store.inbox('msg-1', 'peer-a', { hello: 1 })).toEqual({ ok: true });
      expect(store.count('inbox')).toBe(1);
    } finally {
      store.close();
    }
  });

  it('bounds inbox and outbox retention with busy and leaves the original rows authoritative', () => {
    const store = new Store(':memory:');
    try {
      store.transaction(() => {
        const inboxRow = store.db.prepare('INSERT INTO inbox VALUES (?,?,?,?)');
        const outboxRow = store.db.prepare('INSERT INTO outbox(id,peer,message) VALUES (?,?,?)');
        for (let i = 0; i < 10000; i++) {
          inboxRow.run(`fill-in-${i}`, 'peer-a', 'fingerprint', '"retained"');
          outboxRow.run(`fill-out-${i}`, 'peer-a', '"retained"');
        }
      });
      expect(() => store.receipt('msg-1', 'peer-a', { hello: 1 }, { ok: true })).toThrowError(
        expect.objectContaining({ code: 'busy' }),
      );
      expect(() => store.enqueue('msg-1', 'peer-a', { hello: 1 })).toThrowError(
        expect.objectContaining({ code: 'busy' }),
      );
      expect(store.count('inbox')).toBe(10000);
      expect(store.count('outbox')).toBe(10000);
      expect(store.pending()).toHaveLength(10000);
    } finally {
      store.close();
    }
  });

  it('models a lost ACK: pending keeps the message, ack removes it, and an exact re-enqueue never resends', () => {
    const store = new Store(':memory:');
    try {
      store.enqueue('msg-1', 'peer-a', { hello: 1 });
      store.enqueue('msg-2', 'peer-a', { hello: 2 });
      expect(store.pending().map((m) => m.id)).toEqual(['msg-1', 'msg-2']);
      store.ack('msg-1');
      expect(store.pending().map((m) => m.id)).toEqual(['msg-2']);
      store.enqueue('msg-1', 'peer-a', { hello: 1 });
      expect(store.pending().map((m) => m.id)).toEqual(['msg-2']);
      expect(store.count('outbox')).toBe(2);
      expect(() => store.enqueue('msg-1', 'peer-a', { hello: 'changed' })).toThrowError(
        expect.objectContaining({ code: 'conflict' }),
      );
      expect(() => store.enqueue('msg-1', 'peer-b', { hello: 1 })).toThrowError(
        expect.objectContaining({ code: 'conflict' }),
      );
    } finally {
      store.close();
    }
  });

  it('rolls back a receipt written inside a failed transaction', () => {
    const store = new Store(':memory:');
    try {
      expect(() =>
        store.transaction(() => {
          store.receipt('msg-1', 'peer-a', { hello: 1 }, { ok: true });
          throw new Error('injected crash before commit');
        }),
      ).toThrow('injected crash before commit');
      expect(store.inbox('msg-1', 'peer-a', { hello: 1 })).toBeUndefined();
      expect(store.count('inbox')).toBe(0);
    } finally {
      store.close();
    }
  });
});
