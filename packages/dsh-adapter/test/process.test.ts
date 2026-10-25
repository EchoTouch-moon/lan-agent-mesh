import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DshAcpClient, type LossReason } from '../src/index.js';
import { AcpRpc, type AcpProcessOptions } from '../src/rpc.js';

const clients: { close(): Promise<void> }[] = [];
const roots: string[] = [];
const fixture = fileURLToPath(new URL('./agent-fixture.mjs', import.meta.url));
function options(mode = 'normal'): AcpProcessOptions {
  const cwd = mkdtempSync(join(tmpdir(), 'lam-acp-process-')); roots.push(cwd);
  return { command: process.execPath, args: [fixture, mode], cwd,
    env: { SystemRoot: process.env.SystemRoot, HOME: cwd, USERPROFILE: cwd }, timeoutMs: 10000 };
}
function audit(cwd: string): Record<string, unknown>[] {
  return readFileSync(join(cwd, 'fixture-audit.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
}
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() > deadline) throw new Error('Fixture observation timed out'); await new Promise(r => setTimeout(r, 20)); }
}
async function open(mode = 'normal') {
  const config = options(mode), text: { id: string; text: string }[] = [], lost: LossReason[] = [];
  const client = await DshAcpClient.open({ ...config, onText: (id, value) => text.push({ id, text: value }), onLost: reason => lost.push(reason) });
  clients.push(client); return { client, config, text, lost };
}
afterEach(async () => {
  const errors = await Promise.allSettled(clients.splice(0).map(client => client.close()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  expect(errors.every(result => result.status === 'fulfilled')).toBe(true);
});

describe('DSH ACP owned process control (synthetic peer, no native DSH)', () => {
  it.each(['normal', 'late-update'])('streams only before terminal completion and resumes the original session: %s', async mode => {
    const { client, config, text } = await open(mode);
    const id = await client.createSession(config.cwd);
    expect(await client.prompt(id, 'greeting')).toBe('end_turn');
    expect(text).toEqual([{ id, text: '你好🌙' }]);
    await client.resumeSession(id, config.cwd);
    expect(text).toHaveLength(1); // Resume history is not a new turn.
    await client.closeSession(id); await client.close();
    const restarted = await DshAcpClient.open({ ...config, onText: () => {}, onLost: () => {} }); clients.push(restarted);
    await restarted.resumeSession(id, config.cwd);
    expect(await restarted.prompt(id, 'greeting')).toBe('end_turn');
    const methods = audit(config.cwd).map(m => m.method);
    expect(methods.filter(m => m === 'session/new')).toHaveLength(1);
    expect(methods).not.toContain('session/load');
    expect(audit(config.cwd).filter(m => ['session/new', 'session/resume'].includes(String(m.method))).every(m =>
      (m.params as { mcpServers: unknown[] }).mcpServers.length === 0)).toBe(true);
  });
  it('rejects a busy turn, keeps sessions separate, and confirms cancellation only through the pending prompt reply', async () => {
    const { client, config, text } = await open();
    const a = await client.createSession(config.cwd), b = await client.createSession(config.cwd);
    const pending = client.prompt(a, 'hold');
    await until(() => text.some(t => t.id === a));
    await expect(client.prompt(a, 'duplicate')).rejects.toMatchObject({ code: 'busy', ambiguous: false });
    await expect(client.closeSession(a)).rejects.toMatchObject({ code: 'busy' });
    await expect(client.resumeSession(a, config.cwd)).rejects.toMatchObject({ code: 'busy' });
    expect(await client.prompt(b, 'greeting')).toBe('end_turn');
    expect(client.cancel(a)).toBeUndefined();
    expect(await pending).toBe('cancelled');
    expect(text.filter(t => t.id === a).map(t => t.text)).toEqual(['started', 'cancelled']);
    expect(audit(config.cwd).filter(m => m.method === 'session/prompt')).toHaveLength(2);
    const cancel = audit(config.cwd).find(m => m.method === 'session/cancel');
    expect(cancel).not.toHaveProperty('id');
  });
  it.each(['permission', 'allow-only', 'wrong-session'])('denies permissions and client file writes: %s', async mode => {
    const { client, config } = await open();
    const id = await client.createSession(config.cwd);
    expect(await client.prompt(id, mode)).toBe('end_turn');
    const messages = audit(config.cwd);
    expect(messages.find(m => m.id === 'filesystem-1' && 'error' in m)).toMatchObject({ error: { code: -32601 } });
    expect(messages.find(m => m.id === 'permission-1' && 'result' in m)).toMatchObject({ result: {
      outcome: mode === 'permission' ? { outcome: 'selected', optionId: 'deny' } : { outcome: 'cancelled' },
    } });
    expect(client.deniedNativeRequests).toBe(1);
  });
  it('answers late permission requests with cancelled after cancellation has been requested', async () => {
    const { client, config, text } = await open('cancel-permission');
    const id = await client.createSession(config.cwd), pending = client.prompt(id, 'hold');
    await until(() => text.length > 0);
    client.cancel(id); client.cancel(id);
    expect(await pending).toBe('cancelled');
    expect(audit(config.cwd).find(m => m.id === 'permission-1' && 'result' in m)).toMatchObject({ result: { outcome: { outcome: 'cancelled' } } });
    expect(audit(config.cwd).filter(m => m.method === 'session/cancel')).toHaveLength(1);
  });
  it.each(['malformed', 'oversize', 'invalid-utf8', 'unknown-response', 'conflicting-response', 'invalid-stop', 'stream-flood', 'native-error', 'exit'])(
    'poisons %s streams, reports ambiguous completion and never retries the prompt', async mode => {
      const { client, config, lost } = await open(mode);
      const id = await client.createSession(config.cwd);
      const error = await client.prompt(id, 'greeting').catch(error => error as Error);
      expect(error).toMatchObject({ ambiguous: true });
      expect(String(error)).not.toContain('SECRET_NATIVE_DIAGNOSTIC');
      await expect(client.prompt(id, 'greeting')).rejects.toMatchObject({ ambiguous: true });
      await client.close();
      expect(lost).toHaveLength(1);
      expect(audit(config.cwd).filter(m => m.method === 'session/prompt')).toHaveLength(1);
      expect(JSON.stringify(lost)).not.toContain('SECRET_NATIVE_DIAGNOSTIC');
    });
  it('times out a real in-flight request, terminates its owned child, and remains unusable', async () => {
    const { client, config, lost } = await open('tree');
    const id = await client.createSession(config.cwd);
    await expect(client.prompt(id, 'hold', 1500)).rejects.toMatchObject({ code: 'timeout', ambiguous: true });
    await client.close();
    const descendant = audit(config.cwd).find(m => 'descendant' in m)?.descendant as number;
    expect(descendant).toBeGreaterThan(0);
    await until(() => { try { process.kill(descendant, 0); return false; } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error;
    } });
    expect(lost).toEqual(['timeout']);
  });
  it('refuses incompatible native versions and duplicate native request IDs', async () => {
    const config = options('wrong-version');
    await expect(DshAcpClient.open({ ...config, onText: () => {}, onLost: () => {} })).rejects.toMatchObject({ code: 'protocol' });
    const { client, config: duplicateConfig, lost } = await open('duplicate-permission');
    const id = await client.createSession(duplicateConfig.cwd);
    await expect(client.prompt(id, 'test')).rejects.toMatchObject({ ambiguous: true });
    expect(lost).toEqual(['protocol']);
    await expect(client.createSession(config.cwd)).rejects.toMatchObject({ code: 'closed' });
  });
  it('matches out-of-order replies and bounds pending calls; close rejects all uncertain calls', async () => {
    const config = options(), lost: LossReason[] = [];
    const rpc = new AcpRpc(config, () => {}, reason => lost.push(reason)); clients.push(rpc);
    expect(await Promise.all([rpc.call('echo', { n: 1 }), rpc.call('echo', { n: 2 })])).toEqual([1, 2]);
    const pending = Array.from({ length: 32 }, () => rpc.call('hang', {}).catch(e => e as unknown));
    await expect(rpc.call('hang', {})).rejects.toMatchObject({ code: 'busy', ambiguous: false });
    await rpc.close();
    expect((await Promise.all(pending)).every(e => (e as { ambiguous: boolean }).ambiguous)).toBe(true);
    expect(lost).toEqual(['closed']);
  });
  it('rejects invalid input before sending and survives a throwing loss callback', async () => {
    const { client, config } = await open();
    const id = await client.createSession(config.cwd);
    await expect(client.prompt(id, 'test', 0)).rejects.toMatchObject({ code: 'invalid_input', ambiguous: false });
    expect(await client.prompt(id, 'greeting')).toBe('end_turn');
    const rpc = new AcpRpc(options(), () => {}, () => { throw new Error('consumer'); }); clients.push(rpc);
    await expect(rpc.close()).resolves.toBeUndefined();
  });
});
