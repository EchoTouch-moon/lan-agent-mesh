import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MeshError } from '@lam/protocol';

export type TaskStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_INPUT'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'UNKNOWN';
export interface StoredTask {
  id: string;
  peer: string;
  key: string;
  fingerprint: string;
  state: TaskStatus;
  input: unknown;
  events: unknown[];
}
export const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Single-writer synchronous SQLite boundary. Transactions never span an await. */
export class Store {
  readonly db: DatabaseSync;
  constructor(readonly path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(
      'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;',
    );
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
    if (version > 1) {
      this.db.close();
      throw new Error('Database schema is newer than this Gateway');
    }
    if (version === 0)
      this.transaction(() => {
        for (const table of ['nodes', 'agents', 'sessions', 'messages', 'approvals'])
          this.db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL) STRICT`);
        this.db
          .exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, peer TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, state TEXT NOT NULL, input TEXT NOT NULL, events TEXT NOT NULL, UNIQUE(peer,key)) STRICT;
        CREATE TABLE inbox (id TEXT PRIMARY KEY, peer TEXT NOT NULL, fingerprint TEXT NOT NULL, response TEXT NOT NULL) STRICT;
        CREATE TABLE outbox (id TEXT PRIMARY KEY, peer TEXT NOT NULL, message TEXT NOT NULL, acked INTEGER NOT NULL DEFAULT 0) STRICT;
        CREATE TABLE audit_events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL) STRICT;
        PRAGMA user_version=1;`);
      });
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  put(
    table: 'nodes' | 'agents' | 'sessions' | 'messages' | 'approvals',
    id: string,
    data: unknown,
  ) {
    this.db
      .prepare(
        `INSERT INTO ${table}(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      )
      .run(id, JSON.stringify(data));
  }
  get<T>(
    table: 'nodes' | 'agents' | 'sessions' | 'messages' | 'approvals',
    id: string,
  ): T | undefined {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);
    return row ? (JSON.parse(String(row.data)) as T) : undefined;
  }
  list<T>(table: 'nodes' | 'agents' | 'sessions'): T[] {
    return this.db
      .prepare(`SELECT data FROM ${table}`)
      .all()
      .map((r) => JSON.parse(String(r.data)) as T);
  }
  remove(table: 'nodes' | 'agents' | 'sessions', id: string) {
    this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
  }
  audit(kind: string, subject: string) {
    this.db
      .prepare('INSERT INTO audit_events(at,kind,subject) VALUES (?,?,?)')
      .run(new Date().toISOString(), kind, subject);
  }
  task(id: string): StoredTask | undefined {
    return this.parseTask(this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id));
  }
  private parseTask(row: Record<string, unknown> | undefined): StoredTask | undefined {
    if (!row) return undefined;
    return {
      id: String(row.id),
      peer: String(row.peer),
      key: String(row.key),
      fingerprint: String(row.fingerprint),
      state: row.state as TaskStatus,
      input: JSON.parse(String(row.input)),
      events: JSON.parse(String(row.events)),
    };
  }
  acceptTask(
    id: string,
    peer: string,
    key: string,
    input: unknown,
    limit = 1000,
  ): { task: StoredTask; fresh: boolean } {
    return this.transaction(() => {
      const digest = fingerprint(input);
      const previous = this.parseTask(
        this.db.prepare('SELECT * FROM tasks WHERE peer=? AND key=?').get(peer, key),
      );
      if (previous) {
        if (previous.fingerprint !== digest || previous.id !== id)
          throw new MeshError('conflict', 'Idempotency key conflicts with original task');
        return { task: previous, fresh: false };
      }
      if (this.task(id)) throw new MeshError('conflict', 'Task ID already used');
      if (Number(this.db.prepare('SELECT count(*) AS n FROM tasks').get()?.n) >= limit)
        throw new MeshError('busy', 'Task storage capacity reached');
      this.db
        .prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?)')
        .run(id, peer, key, digest, 'QUEUED', JSON.stringify(input), '[]');
      this.audit('task.accepted', id);
      return { task: this.task(id)!, fresh: true };
    });
  }
  event(id: string, state: TaskStatus, event: unknown) {
    this.transaction(() => {
      const task = this.task(id);
      if (!task) throw new MeshError('not_found', 'Task not found');
      if (task.events.length >= 4096) throw new MeshError('busy', 'Task event limit exceeded');
      task.events.push(event);
      this.db
        .prepare('UPDATE tasks SET state=?,events=? WHERE id=?')
        .run(state, JSON.stringify(task.events), id);
    });
  }
  recover(): string[] {
    return this.transaction(() => {
      const rows = this.db
        .prepare("SELECT id FROM tasks WHERE state IN ('QUEUED','RUNNING','WAITING_INPUT')")
        .all();
      for (const r of rows) this.eventWithoutTransaction(String(r.id));
      return rows.map((r) => String(r.id));
    });
  }
  private eventWithoutTransaction(id: string) {
    const task = this.task(id)!;
    task.events.push({
      type: 'unknown',
      taskId: id,
      reason: 'Gateway restarted; execution outcome uncertain, never auto-replay',
    });
    this.db
      .prepare("UPDATE tasks SET state='UNKNOWN',events=? WHERE id=?")
      .run(JSON.stringify(task.events), id);
    this.audit('task.recovered_unknown', id);
  }
  inbox(id: string, peer: string, request: unknown): unknown | undefined {
    const row = this.db.prepare('SELECT * FROM inbox WHERE id=?').get(id);
    if (!row) return undefined;
    if (row.peer !== peer || row.fingerprint !== fingerprint(request))
      throw new MeshError('conflict', 'Message ID conflict');
    return JSON.parse(String(row.response));
  }
  receipt(id: string, peer: string, request: unknown, response: unknown) {
    if (this.count('inbox') >= 10000)
      throw new MeshError('busy', 'Inbox retention capacity reached');
    this.db
      .prepare('INSERT INTO inbox VALUES (?,?,?,?)')
      .run(id, peer, fingerprint(request), JSON.stringify(response));
  }
  enqueue(id: string, peer: string, message: unknown) {
    const previous = this.db.prepare('SELECT * FROM outbox WHERE id=?').get(id);
    if (previous) {
      if (previous.peer !== peer || previous.message !== JSON.stringify(message))
        throw new MeshError('conflict', 'Outbox message conflict');
      return;
    }
    if (this.count('outbox') >= 10000)
      throw new MeshError('busy', 'Outbox retention capacity reached');
    this.db
      .prepare('INSERT INTO outbox(id,peer,message) VALUES (?,?,?)')
      .run(id, peer, JSON.stringify(message));
  }
  ack(id: string) {
    this.db.prepare('UPDATE outbox SET acked=1 WHERE id=?').run(id);
  }
  pending(): { id: string; peer: string; message: unknown }[] {
    return this.db
      .prepare('SELECT * FROM outbox WHERE acked=0')
      .all()
      .map((r) => ({
        id: String(r.id),
        peer: String(r.peer),
        message: JSON.parse(String(r.message)),
      }));
  }
  count(table: 'inbox' | 'outbox' | 'tasks' | 'audit_events'): number {
    return Number(this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);
  }
  query(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).all(...params);
  }
  close() {
    this.db.close();
  }
}
