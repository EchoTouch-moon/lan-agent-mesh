import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZcodeAdapter, type ZcodeOptions } from '../src/index.js';
import { ZcodeRpc } from '../src/rpc.js';
import type { AdapterEvent } from '@lam/adapter-sdk';

it('bounds stdio, poisons timed-out mutations and redacts native error bodies', async () => {
  let lost = 0;
  const rpc = new ZcodeRpc(process.execPath, ['-e', `process.stdin.on('data',()=>{});setInterval(()=>{},1000)`], process.env, tmpdir(), () => {}, () => lost++, 100);
  try {
    await expect(rpc.call('session/send', {})).rejects.toThrow('outcome unknown');
    await expect(rpc.call('session/send', {})).rejects.toThrow('unavailable');
    expect(lost).toBe(1);
  } finally { await rpc.close(); }
  const error = new ZcodeRpc(process.execPath, ['-e', `process.stdin.on('data', b=>console.log(JSON.stringify({id:JSON.parse(b).id,error:{message:'secret-native-token'}})))`], process.env, tmpdir(), () => {}, () => {});
  try { await expect(error.call('session/create', {})).rejects.toThrow('Native request rejected'); }
  finally { await error.close(); }
});

describe('ZCode adapter protocol invariants (synthetic app-server)', () => {
  function setup() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'lam-zcode-adapter-unit-')));
    const workspace = join(root, 'workspace'); mkdirSync(workspace, { mode: 0o700 });
    const executable = fileURLToPath(new URL('./fake-zcode-server.mjs', import.meta.url));
    const options: ZcodeOptions = { nodeId: 'unit-node', executable, home: join(root, 'home'), workspaces: { fixture: workspace }, fixtureBaseUrl: 'http://127.0.0.1:12345/v1', expectedVersion: '0.17.0', syntheticPeer: true };
    return { root, options };
  }
  async function events(adapter: ZcodeAdapter, task: string) {
    const result: AdapterEvent[] = []; for await (const event of adapter.watch(task)) result.push(event); return result;
  }
  function input(sessionId: string, taskId: string, key: string, text = 'hello', deadlineMs = 10000) {
    return { sessionId, taskId, text, idempotencyKey: key, deadline: new Date(Date.now() + deadlineMs).toISOString() };
  }
  it('persists distinct session mapping, exact retries, conflict rejection and native deny', async () => {
    const { root, options } = setup(); let adapter: ZcodeAdapter | undefined;
    try {
      adapter = await ZcodeAdapter.open(options);
      const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' });
      expect(session.id).not.toBe(session.nativeSessionId);
      const first = input(session.id, 't1', 'k1', 'permission');
      await adapter.send(first);
      const denied = await events(adapter, 't1');
      expect(denied.at(-1)).toEqual({ type: 'completed', taskId: 't1', text: 'denied' });
      expect(adapter.deniedNativeRequests).toBe(1);
      await expect(adapter.send(first)).resolves.toEqual({ taskId: 't1' });
      await expect(adapter.send({ ...first, text: 'other' })).rejects.toThrow('Idempotency');
      await expect(adapter.answerPermission()).rejects.toThrow('always denied');
      await adapter.close(); adapter = await ZcodeAdapter.open(options);
      expect((await adapter.resume(session.id)).nativeSessionId).toBe(session.nativeSessionId);
      expect((await events(adapter, 't1')).at(-1)?.type).toBe('completed');
      await expect(adapter.send(first)).resolves.toEqual({ taskId: 't1' });
    } finally { await adapter?.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('drops foreign and post-terminal native events', async () => {
    const { root, options } = setup(); let adapter: ZcodeAdapter | undefined;
    try {
      adapter = await ZcodeAdapter.open(options);
      const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' });
      await adapter.send(input(session.id, 't1', 'k1', 'dedup'));
      const result = await events(adapter, 't1');
      expect(result).toEqual([
        { type: 'delta', taskId: 't1', text: 'dedup' },
        { type: 'completed', taskId: 't1', text: 'dedup' },
      ]);
    } finally { await adapter?.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('serializes turns, cancels in-flight work and keeps crash outcomes UNKNOWN across restart', async () => {
    const { root, options } = setup(); let adapter: ZcodeAdapter | undefined;
    try {
      adapter = await ZcodeAdapter.open(options);
      const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' });
      await adapter.send(input(session.id, 't1', 'k1', 'hold'));
      const stream = adapter.watch('t1')[Symbol.asyncIterator](); expect((await stream.next()).value?.type).toBe('delta'); await stream.return?.(undefined);
      await expect(adapter.send(input(session.id, 't2', 'k2'))).rejects.toThrow('already active');
      await adapter.cancel('t1'); expect((await events(adapter, 't1')).at(-1)?.type).toBe('cancelled');
      const crash = input(session.id, 't3', 'k3', 'crash');
      await adapter.send(crash); expect((await events(adapter, 't3')).at(-1)?.type).toBe('unknown');
      await adapter.close(); adapter = await ZcodeAdapter.open(options);
      await expect(adapter.send(crash)).resolves.toEqual({ taskId: 't3' });
      await expect(adapter.resume(session.id)).rejects.toThrow('ambiguous');
      await expect(adapter.send(input(session.id, 't4', 'k4'))).rejects.toThrow('ambiguous');
    } finally { await adapter?.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('ends elapsed-deadline turns as UNKNOWN without native replay', async () => {
    const { root, options } = setup(); let adapter: ZcodeAdapter | undefined;
    try {
      adapter = await ZcodeAdapter.open(options);
      const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' });
      await adapter.send(input(session.id, 't1', 'k1', 'hold', 150));
      const result = await events(adapter, 't1');
      expect(result.at(-1)?.type).toBe('unknown');
      await expect(adapter.send(input(session.id, 't1', 'k1', 'hold', 150))).rejects.toThrow('offline');
      await expect(adapter.send(input(session.id, 't2', 'k2'))).rejects.toThrow('offline');
    } finally { await adapter?.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('drops foreign-session terminals and delivers only the owning session outcome', async () => {
    const { root, options } = setup(); let adapter: ZcodeAdapter | undefined;
    try {
      adapter = await ZcodeAdapter.open(options);
      const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' });
      await adapter.send(input(session.id, 't1', 'k1', 'crosssession'));
      const result = await events(adapter, 't1');
      // The foreign claim (cancelled) must be dropped; the genuine terminal (success) closes the run.
      expect(result).toEqual([
        { type: 'delta', taskId: 't1', text: 'crosssession' },
        { type: 'completed', taskId: 't1', text: 'crosssession' },
      ]);
    } finally { await adapter?.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('streams a NEW task on a resumed session after adapter restart', async () => {
    const { root, options } = setup(); let adapter: ZcodeAdapter | undefined;
    try {
      adapter = await ZcodeAdapter.open(options);
      const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' });
      await adapter.send(input(session.id, 't1', 'k1', 'warm'));
      expect((await events(adapter, 't1')).at(-1)?.type).toBe('completed');
      await adapter.close(); adapter = await ZcodeAdapter.open(options);
      await adapter.resume(session.id);
      // Without a re-subscribe after resume the (fresh) native process never delivers events
      // and this turn would end UNKNOWN at its deadline instead of completing.
      await adapter.send(input(session.id, 't2', 'k2', 'afterrestart'));
      const result = await events(adapter, 't2');
      expect(result.at(-1)).toEqual({ type: 'completed', taskId: 't2', text: 'afterrestart' });
    } finally { await adapter?.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('pins the executable hash: a mismatched expectation refuses to open', async () => {
    const { root, options } = setup(); let adapter: ZcodeAdapter | undefined;
    try {
      const digest = createHash('sha256').update(readFileSync(options.executable)).digest('hex');
      await expect(ZcodeAdapter.open({ ...options, expectedExecutableSha256: '0'.repeat(64) })).rejects.toThrow('sha256 does not match');
      adapter = await ZcodeAdapter.open({ ...options, expectedExecutableSha256: digest });
      expect(adapter.executableSha256).toBe(digest);
      await expect(ZcodeAdapter.open({ ...options, expectedExecutableSha256: 'not-hex' })).rejects.toThrow('64 lowercase hex');
    } finally { await adapter?.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('refuses user configuration homes, external providers and concurrent ownership', async () => {
    const { root, options } = setup(); let adapter: ZcodeAdapter | undefined;
    try {
      mkdirSync(options.home, { mode: 0o700 }); writeFileSync(join(options.home, 'config.toml'), 'must not read', { mode: 0o600 });
      await expect(ZcodeAdapter.open(options)).rejects.toThrow('initialization refused');
      await expect(ZcodeAdapter.open({ ...options, fixtureBaseUrl: 'https://api.openai.com/v1' })).rejects.toThrow('loopback');
      rmSync(options.home, { recursive: true, force: true }); adapter = await ZcodeAdapter.open(options);
      await expect(ZcodeAdapter.open(options)).rejects.toThrow('initialization refused');
      expect((await adapter.probe()).available).toBe(true);
      expect(typeof adapter.executableSha256).toBe('string');
      await adapter.close(); adapter = undefined;
      adapter = await ZcodeAdapter.open(options);
      expect((await adapter.probe()).available).toBe(true);
    } finally { await adapter?.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
