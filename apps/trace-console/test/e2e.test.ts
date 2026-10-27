// End-to-end read-only observation: a real caller Gateway and real receiver
// Gateways over loopback TCP/Noise/Yamux with the deterministic mock adapter,
// plus the negative security cases required by OBS-0 (auth, origin, host,
// CSRF, whitelist, XSS handling, cross-grant invisibility, token confinement).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { request as requestRaw } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Gateway } from '@lam/runtime';
import type { Session } from '@lam/domain';
import type { MockScenario } from '@lam/mock-adapter';
import { TraceConsole } from '../src/server.js';

const roots: string[] = [];
const gateways: Gateway[] = [];
let trace: TraceConsole | undefined;
let base = '';

function gateway(scenario: MockScenario = {}, mock = true) {
  const directory = mkdtempSync(join(tmpdir(), 'LAM trace '));
  roots.push(directory);
  const g = new Gateway({ directory, mock, scenario, listen: ['/ip4/127.0.0.1/tcp/0'], mdns: false });
  gateways.push(g);
  return g.start().then((started) => ({ started, directory }));
}

async function pair(a: Gateway, b: Gateway) {
  const p = await a.mesh.beginPairing(b.mesh.addresses[0]!);
  const q = b.mesh.pendingPairings().find((q) => q.id === p.id)!;
  await a.mesh.confirmPairing(p.id, p.code);
  await b.mesh.confirmPairing(q.id, q.code);
  expect(a.mesh.trusted(b.mesh.id)).toBe(true);
}

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

function api(path: string, init: RequestInit = {}, cookie: string): Promise<Response> {
  return fetch(base + path, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), cookie } });
}

async function spawnSession(caller: Gateway, receiver: Gateway): Promise<Session> {
  const registry = await caller.sync(receiver.mesh.id);
  const creation = caller.envelope(receiver.mesh.id, 'session.create', {
    agentId: registry.agents[0]!.id,
    workspaceAlias: 'project-a',
  });
  creation.deadline = new Date(Date.now() + 120000).toISOString();
  const created = await caller.sendEnvelope(receiver.mesh.id, creation);
  if (created.type !== 'session.event') throw new Error('session.create failed');
  return created.payload as Session;
}

interface DrainResult {
  ok: boolean;
  state?: string | undefined;
  events: { seq: number; type: string; preview?: string | undefined; permission?: unknown }[];
  notObservable?: boolean | undefined;
  error?: string | undefined;
  reason?: string | undefined;
}

async function drainTask(cookie: string, peer: string, taskId: string): Promise<DrainResult> {
  let cursor = 0;
  const events: DrainResult['events'] = [];
  for (let i = 0; i < 400; i++) {
    const response = await api(
      `/api/task?peer=${encodeURIComponent(peer)}&taskId=${encodeURIComponent(taskId)}&cursor=${cursor}`,
      {},
      cookie,
    );
    const data = (await response.json()) as {
      ok: boolean; state?: string; events?: DrainResult['events']; next?: number;
      terminal?: boolean; notObservable?: boolean; error?: string; reason?: string;
    };
    if (data.ok === false) return { ok: false, events, notObservable: data.notObservable, error: data.error, reason: data.reason };
    events.push(...(data.events ?? []));
    cursor = data.next ?? cursor;
    if (data.terminal && (data.events ?? []).length === 0) return { ok: true, state: data.state, events };
    await delay(10);
  }
  throw new Error('task drain timeout');
}

describe('trace console over two real loopback gateways', () => {
  let caller: Gateway;
  let callerDirectory: string;
  let receiver: Gateway;
  let cookie: string;
  let csrf: string;

  beforeEach(async () => {
    const a = await gateway({}, false);
    caller = a.started;
    callerDirectory = a.directory;
    const b = await gateway({ chunks: ['hello ', 'trace'], delayMs: 10 });
    receiver = b.started;
    await pair(caller, receiver);
    trace = await TraceConsole.start({ directory: callerDirectory });
    base = `http://127.0.0.1:${trace.port}`;
    const login = await fetch(trace.loginUrl, { redirect: 'manual' });
    expect(login.status).toBe(302);
    const setCookies = login.headers.getSetCookie();
    cookie = cookiesOf(login);
    csrf = (setCookies.find((c) => c.startsWith('lam_trace_csrf=')) ?? '').split(';')[0]!.split('=')[1]!;
    expect(setCookies.some((c) => c.includes('HttpOnly') && c.includes('SameSite=Strict'))).toBe(true);
  });

  afterEach(async () => {
    await trace?.stop();
    trace = undefined;
    for (const g of gateways.splice(0)) await g.stop();
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  });

  it('serves the read-only page only after a valid one-time login', async () => {
    expect((await fetch(base + '/')).status).toBe(401);
    expect((await fetch(base + '/?t=deadbeef')).status).toBe(401);
    // The startup token was consumed in beforeEach: a second use must fail.
    expect((await fetch(trace!.loginUrl, { redirect: 'manual' })).status).toBe(401);

    const page = await api('/', {}, cookie);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    const html = await page.text();
    expect(html).toContain('只读观察');
    expect(html).not.toContain(caller.token);
    expect((await api('/app.js', {}, cookie)).status).toBe(200);
    expect((await api('/app.css', {}, cookie)).status).toBe(200);
    expect((await api('/app.js', {}, '')).status).toBe(401);
  });

  it('shows real Gateway status, peers and diagnostics; caller-side session list is an honest empty boundary', async () => {
    const session = await spawnSession(caller, receiver);
    const response = await api('/api/overview', {}, cookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      status: { nodeId: string; addresses: string[] };
      peers: { peer: string }[];
      sessions: unknown[];
      diagnostics: { approvalPolicy: string };
      nodes: { peer: string; source: string; online: boolean | null; trusted: boolean | null }[];
    };
    expect(body.ok).toBe(true);
    expect(body.status.nodeId).toBe(caller.mesh.id);
    expect(body.peers.some((p) => p.peer === receiver.mesh.id)).toBe(true);
    // Sessions are persisted by the node that owns the agent (the receiver);
    // the caller Gateway legitimately has none — no data is invented here.
    expect(body.sessions).toEqual([]);
    expect(session.id).toBeTruthy();
    expect(body.diagnostics.approvalPolicy).toBe('deny-only');
    // Multi-node table: the receiver appears as a node. The first overview
    // merges it from discovery and starts the throttled registry probe; a
    // second call makes sure the probe result is reflected.
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(body.nodes.some((n) => n.peer === receiver.mesh.id)).toBe(true);
    const second = (await (await api('/api/overview', {}, cookie)).json()) as {
      nodes: { peer: string; source: string; online: boolean | null; trusted: boolean | null }[];
    };
    const receiverNode = second.nodes.find((n) => n.peer === receiver.mesh.id);
    expect(receiverNode).toBeDefined();
    expect(receiverNode!.online).not.toBeNull();
    // Caller and receiver are paired and loopback-connected: the registry
    // probe must resolve to paired + online.
    expect(receiverNode!.online).toBe(true);
    expect(receiverNode!.trusted).toBe(true);
    expect(['discovered', 'pairing', 'pending', 'task']).toContain(receiverNode!.source);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(caller.token);
    // Loopback multiaddrs stay visible; nothing outside loopback exists here.
    expect(body.status.addresses.join(' ')).toContain('127.0.0.1');
  });

  it('streams a completed task event-by-event in cursor order', async () => {
    const session = await spawnSession(caller, receiver);
    const { taskId } = await caller.submit(receiver.mesh.id, session, 'observe me');
    const result = await drainTask(cookie, receiver.mesh.id, taskId);
    expect(result.ok).toBe(true);
    expect(result.state).toBe('COMPLETED');
    const types = result.events.map((e) => e.type);
    expect(types[0]).toBe('started');
    expect(types).toContain('delta');
    expect(types[types.length - 1]).toBe('completed');
    expect(result.events.map((e) => e.seq)).toEqual(result.events.map((_, i) => i));
    const completed = result.events.find((e) => e.type === 'completed');
    expect(completed!.preview).toContain('hello trace');
  });

  it('keeps hostile task text as inert JSON data, never as markup', async () => {
    const echoing = await gateway({}); // default mock chunks echo the task text
    await pair(caller, echoing.started);
    const session = await spawnSession(caller, echoing.started);
    const payload = '<img src=x onerror=window.__pwned(1)><script>alert(1)</script>';
    const { taskId } = await caller.submit(echoing.started.mesh.id, session, payload);
    const result = await drainTask(cookie, echoing.started.mesh.id, taskId);
    expect(result.state).toBe('COMPLETED');
    const echoed = result.events.find((e) => e.type === 'completed');
    expect(echoed!.preview).toContain('mock:');
    // The hostile text round-trips as an inert JSON string in every event.
    expect(JSON.stringify(result.events)).toContain('<img src=x onerror=');
    const response = await api(
      `/api/task?peer=${encodeURIComponent(echoing.started.mesh.id)}&taskId=${encodeURIComponent(taskId)}&cursor=0`,
      {},
      cookie,
    );
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const page = await api('/', {}, cookie);
    expect(await page.text()).not.toContain('<img');
  });

  it('distinguishes terminal CANCELLED from an in-flight cancel request', async () => {
    const slow = await gateway({ chunks: ['a', 'b', 'c'], delayMs: 250 });
    await pair(caller, slow.started);
    const session = await spawnSession(caller, slow.started);
    const { taskId } = await caller.submit(slow.started.mesh.id, session, 'cancel me');
    await delay(150);
    // Cancel is issued by the real caller Gateway, not by the console: the
    // console must merely observe the request-to-terminal progression.
    await caller.command('cancel', { peer: slow.started.mesh.id, taskId });
    const result = await drainTask(cookie, slow.started.mesh.id, taskId);
    expect(result.state).toBe('CANCELLED');
    expect(result.events[result.events.length - 1]!.type).toBe('cancelled');
  });

  it('reports UNKNOWN terminal state after an injected adapter disconnect', async () => {
    const flaky = await gateway({ disconnectAfterChunks: 0 });
    await pair(caller, flaky.started);
    const session = await spawnSession(caller, flaky.started);
    const { taskId } = await caller.submit(flaky.started.mesh.id, session, 'go dark');
    const result = await drainTask(cookie, flaky.started.mesh.id, taskId);
    expect(result.state).toBe('UNKNOWN');
    expect(result.events.some((e) => e.type === 'unknown')).toBe(true);
  });

  it('records the permission request and the deny-only FAILED outcome', async () => {
    const guarded = await gateway({ permission: true, chunks: ['never'] });
    await pair(caller, guarded.started);
    const session = await spawnSession(caller, guarded.started);
    const { taskId } = await caller.submit(guarded.started.mesh.id, session, 'needs approval');
    const result = await drainTask(cookie, guarded.started.mesh.id, taskId);
    // The router persists the permission event under WAITING_INPUT before its
    // deny-only policy answers it; the mock then fails with permission_denied.
    expect(result.events.some((e) => e.type === 'permission')).toBe(true);
    expect(result.state).toBe('FAILED');
    const failed = result.events.find((e) => e.type === 'failed');
    expect(failed).toBeDefined();
  });

  it('refuses cross-grant observation: an unpaired peer is not observable', async () => {
    const stranger = await gateway({}, false);
    const response = await api(
      `/api/task?peer=${encodeURIComponent(stranger.started.mesh.id)}&taskId=${encodeURIComponent(randomUUID())}&cursor=0`,
      {},
      cookie,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.notObservable).toBe(true);
  });

  it('marks locally-received tasks NOT-OBSERVABLE instead of inventing data', async () => {
    const response = await api(
      `/api/task?peer=${encodeURIComponent(caller.mesh.id)}&taskId=${encodeURIComponent(randomUUID())}&cursor=0`,
      {},
      cookie,
    );
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.notObservable).toBe(true);
    expect(body.reason).toContain('V0');
  });

  it('exports a bounded redacted JSON transcript', async () => {
    const session = await spawnSession(caller, receiver);
    const { taskId } = await caller.submit(receiver.mesh.id, session, 'export me');
    await drainTask(cookie, receiver.mesh.id, taskId);
    const response = await api(
      `/api/export?peer=${encodeURIComponent(receiver.mesh.id)}&taskId=${encodeURIComponent(taskId)}`,
      {},
      cookie,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment');
    const body = (await response.json()) as { taskId: string; state: string; events: unknown[]; redaction: string };
    expect(body.taskId).toBe(taskId);
    expect(body.state).toBe('COMPLETED');
    expect(body.events.length).toBeGreaterThan(2);
    expect(body.redaction).toContain('whitelist');
    expect(JSON.stringify(body)).not.toContain(caller.token);
  });

  describe('transport and request hardening negatives', () => {
    it('rejects missing session cookie on every API route', async () => {
      for (const path of ['/api/overview', '/api/task?peer=x&taskId=y&cursor=0', '/api/export?peer=x&taskId=y']) {
        const response = await fetch(base + path);
        expect(response.status).toBe(401);
      }
    });

    it('rejects cross-origin API calls even with a valid session', async () => {
      const response = await api('/api/overview', { headers: { origin: 'http://evil.example' } }, cookie);
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toBe('forbidden_origin');
    });

    it('rejects disallowed Host headers (DNS-rebinding defence)', async () => {
      // undici refuses to override the reserved Host header, so send raw HTTP.
      const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const request = requestRaw(
          { host: '127.0.0.1', port: trace!.port, path: '/api/overview', method: 'GET', headers: { host: 'evil.example', cookie } },
          (res) => {
            let body = '';
            res.on('data', (chunk: Buffer) => (body += chunk.toString()));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
          },
        );
        request.on('error', reject);
        request.end();
      });
      expect(response.status).toBe(403);
      expect(JSON.parse(response.body).error).toBe('forbidden_host');
    });

    it('requires a CSRF double-submit for state-changing console requests', async () => {
      const missing = await api('/api/reconnect', { method: 'POST' }, cookie);
      expect(missing.status).toBe(403);
      const wrong = await api('/api/reconnect', { method: 'POST', headers: { 'x-lam-csrf': 'not-the-csrf' } }, cookie);
      expect(wrong.status).toBe(403);
      const good = await api('/api/reconnect', { method: 'POST', headers: { 'x-lam-csrf': csrf } }, cookie);
      expect(((await good.json()) as { ok: boolean }).ok).toBe(true);
    });

    it('exposes no mutating proxy route: every non-whitelisted API path is 404', async () => {
      for (const path of [
        '/api/send', '/api/cancel', '/api/pair', '/api/confirm', '/api/spawn', '/api/resume',
        '/api/retry', '/api/shutdown', '/api/command', '/api/mcp-grant', '/api/revoke',
      ]) {
        const response = await api(path, { method: 'POST', headers: { 'x-lam-csrf': csrf } }, cookie);
        expect(response.status).toBe(404);
      }
    });

    it('rejects invalid task identifiers instead of proxying them', async () => {
      const response = await api('/api/task?peer=../../etc&taskId=x&cursor=0', {}, cookie);
      expect(response.status).toBe(400);
      const negative = await api('/api/task?peer=p&taskId=t&cursor=-1', {}, cookie);
      expect(negative.status).toBe(400);
    });
  });

  it('reports an unreachable Gateway honestly instead of faking data', async () => {
    await caller.stop();
    const response = await api('/api/overview', {}, cookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; error: string; status: unknown };
    expect(body.ok).toBe(false);
    expect(body.status).toBeNull();
  });

  it('re-attaches after the Gateway restarts and rotates its control token', async () => {
    const directory = callerDirectory;
    await caller.stop();
    const restarted = new Gateway({ directory, mock: false, listen: ['/ip4/127.0.0.1/tcp/0'], mdns: false });
    gateways.push(restarted);
    await restarted.start();
    const stale = await api('/api/overview', {}, cookie);
    expect(((await stale.json()) as { ok: boolean }).ok).toBe(false);
    const reattach = await api('/api/reconnect', { method: 'POST', headers: { 'x-lam-csrf': csrf } }, cookie);
    expect(((await reattach.json()) as { ok: boolean }).ok).toBe(true);
    const fresh = await api('/api/overview', {}, cookie);
    const body = (await fresh.json()) as { ok: boolean; status: { nodeId: string } };
    expect(body.ok).toBe(true);
    expect(body.status.nodeId).toBe(restarted.mesh.id);
  });
});
