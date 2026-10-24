import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, chmodSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexAdapter, type CodexOptions } from '../src/index.js';
import { CodexRpc } from '../src/rpc.js';
import type { AdapterEvent } from '@lam/adapter-sdk';

it('bounds stdio, poisons timed-out mutations and redacts native error bodies', async () => {
  let lost = 0;
  const rpc = new CodexRpc(process.execPath, ['-e', `process.stdin.on('data',()=>{});setInterval(()=>{},1000)`], process.env, tmpdir(), () => {}, () => lost++, 100);
  try {
    await expect(rpc.call('turn/start', {})).rejects.toThrow('outcome unknown');
    await expect(rpc.call('turn/start', {})).rejects.toThrow('unavailable');
    expect(lost).toBe(1);
  } finally { await rpc.close(); }
  const error = new CodexRpc(process.execPath, ['-e', `process.stdin.on('data', b=>console.log(JSON.stringify({id:JSON.parse(b).id,error:{message:'secret-native-token'}})))`], process.env, tmpdir(), () => {}, () => {});
  try { await expect(error.call('thread/start', {})).rejects.toThrow('Native request rejected'); }
  finally { await error.close(); }
});

describe.skipIf(process.platform !== 'darwin')('Codex adapter protocol invariants (synthetic app-server)', () => {
  function setup() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'lam-adapter-unit-')));
    const workspace = join(root, 'workspace'); mkdirSync(workspace, { mode: 0o700 });
    const executable = fileURLToPath(new URL('./fake-app-server.mjs', import.meta.url)); chmodSync(executable, 0o700);
    const options: CodexOptions = { nodeId: 'unit-node', executable, home: join(root, 'home'), workspaces: { fixture: workspace }, fixtureBaseUrl: 'http://127.0.0.1:12345/v1', expectedVersion: 'codex-cli 0.146.0' };
    return { root, options };
  }
  async function events(adapter: CodexAdapter, task: string) {
    const result: AdapterEvent[] = []; for await (const event of adapter.watch(task)) result.push(event); return result;
  }
  it('persists distinct thread mapping, exact retries, conflict rejection and native deny', async () => {
    const { root, options } = setup(); let adapter: CodexAdapter | undefined;
    try {
      adapter = await CodexAdapter.open(options);
      const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' });
      expect(session.id).not.toBe(session.nativeSessionId);
      const input = { sessionId: session.id, taskId: 't1', text: 'permission', idempotencyKey: 'k1', deadline: new Date(Date.now() + 10000).toISOString() };
      await adapter.send(input); const result = await events(adapter, 't1');
      expect(result.at(-1)).toEqual({ type: 'completed', taskId: 't1', text: 'denied' });
      expect(adapter.deniedNativeRequests).toBe(1);
      await expect(adapter.send({ ...input })).resolves.toEqual({ taskId: 't1' });
      await expect(adapter.send({ ...input, text: 'other' })).rejects.toThrow('Idempotency');
      await expect(adapter.answerPermission()).rejects.toThrow('always denied');
      await adapter.close(); adapter = await CodexAdapter.open(options);
      expect((await adapter.resume(session.id)).nativeSessionId).toBe(session.nativeSessionId);
      expect((await events(adapter, 't1')).at(-1)?.type).toBe('completed');
      await expect(adapter.send(input)).resolves.toEqual({ taskId: 't1' });
    } finally { await adapter?.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('serializes turns, cancels in-flight work and keeps crash outcomes UNKNOWN across restart', async () => {
    const { root, options } = setup(); let adapter: CodexAdapter | undefined;
    try {
      adapter = await CodexAdapter.open(options);
      const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' });
      const input = { sessionId: session.id, taskId: 't1', text: 'hold', idempotencyKey: 'k1', deadline: new Date(Date.now() + 10000).toISOString() };
      await adapter.send(input);
      const stream = adapter.watch('t1')[Symbol.asyncIterator](); expect((await stream.next()).value?.type).toBe('delta'); await stream.return?.(undefined);
      await expect(adapter.send({ ...input, taskId: 't2', idempotencyKey: 'k2' })).rejects.toThrow('already active');
      await adapter.cancel('t1'); expect((await events(adapter, 't1')).at(-1)?.type).toBe('cancelled');
      const crash = { ...input, taskId: 't3', idempotencyKey: 'k3', text: 'crash' };
      await adapter.send(crash); expect((await events(adapter, 't3')).at(-1)?.type).toBe('unknown');
      await adapter.close(); adapter = await CodexAdapter.open(options);
      await expect(adapter.send(crash)).resolves.toEqual({ taskId: 't3' });
      await expect(adapter.resume(session.id)).rejects.toThrow('ambiguous');
      await expect(adapter.send({ ...input, taskId: 't4', idempotencyKey: 'k4' })).rejects.toThrow('ambiguous');
    } finally { await adapter?.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('refuses user configuration homes, external providers and concurrent ownership', async () => {
    const { root, options } = setup(); let adapter: CodexAdapter | undefined;
    try {
      mkdirSync(options.home, { mode: 0o700 }); writeFileSync(join(options.home, 'config.toml'), 'must not read', { mode: 0o600 });
      await expect(CodexAdapter.open(options)).rejects.toThrow('initialization refused');
      await expect(CodexAdapter.open({ ...options, fixtureBaseUrl: 'https://api.openai.com/v1' })).rejects.toThrow('loopback');
      rmSync(options.home, { recursive: true }); adapter = await CodexAdapter.open(options);
      await expect(CodexAdapter.open(options)).rejects.toThrow('initialization refused');
      expect((await adapter.probe()).available).toBe(true);
    } finally { await adapter?.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
