// Loopback-only read-only trace console sidecar. The browser never talks to
// the Gateway directly (the Gateway rejects any request carrying an Origin
// header); every datum shown on the page is fetched server-side through the
// whitelisted read-only control commands and redacted before it is returned.

import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { GatewayReader, GatewayError } from './gateway.js';
import {
  redactEvents,
  redactStatus,
  redactPeers,
  redactSessions,
  redactPending,
  redactPairings,
  redactNodes,
  redactDiagnostics,
  type NodeSource,
  type RedactedNode,
} from './redact.js';
import { PAGE_HTML, PAGE_JS, PAGE_CSS } from './page.js';

const TERMINAL_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN']);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const MAX_SESSIONS = 16;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const EXPORT_EVENT_LIMIT = 4096;
const EXPORT_TIME_BUDGET_MS = 60000;
// Multi-node online probing: at most PROBE_BUDGET registry round-trips per
// overview request, one per peer per PROBE_TTL_MS, plus a soft cap so a
// paired-but-offline peer's dial timeout cannot stall the overview response.
const PROBE_TTL_MS = 10_000;
const PROBE_BUDGET = 2;
const PROBE_SOFT_CAP_MS = 2_000;
const SOURCE_RANK: Record<NodeSource, number> = {
  discovered: 0,
  pending: 1,
  pairing: 2,
  task: 3,
};

interface KnownPeer {
  addresses: string[];
  source: NodeSource;
  lastProbe: { online: boolean; trusted: boolean | null; at: number } | null;
}

interface ConsoleSession {
  csrf: string;
  at: number;
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return cookies;
}

function equalSecret(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface TraceConsoleOptions {
  /** Private Gateway data directory containing control.json. */
  directory: string;
  /** Loopback port; 0 (default) picks a free port. */
  port?: number;
}

export class TraceConsole {
  private readonly server: Server;
  private readonly reader: GatewayReader;
  private readonly sessions = new Map<string, ConsoleSession>();
  /** Every peer id the console has legitimately seen (discovery, pairing,
   * un-ACKed outbox traffic, observed tasks), kept in memory only. */
  private readonly knownPeers = new Map<string, KnownPeer>();
  private readonly probing = new Set<string>();
  private probeCursor = 0;
  private loginToken: string | null = null;
  private stopping = false;
  readonly port: number;
  readonly loginUrl: string;

  private constructor(
    readonly options: TraceConsoleOptions,
    server: Server,
    reader: GatewayReader,
    port: number,
  ) {
    this.server = server;
    this.reader = reader;
    this.port = port;
    this.loginToken = randomBytes(32).toString('hex');
    this.loginUrl = `http://127.0.0.1:${port}/?t=${this.loginToken}`;
  }

  static async start(options: TraceConsoleOptions): Promise<TraceConsole> {
    const reader = await GatewayReader.attach(options.directory);
    const holder: { instance?: TraceConsole } = {};
    const server = createServer((req, res) => {
      const current = holder.instance;
      if (!current) {
        res.writeHead(503).end();
        return;
      }
      void current.dispatch(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal' }));
      });
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address !== 'string') resolve(address.port);
        else reject(new Error('Missing trace console port'));
      });
    });
    holder.instance = new TraceConsole(options, server, reader, port);
    return holder.instance;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private securityHeaders(res: ServerResponse, contentType: string): void {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (contentType === 'text/html; charset=utf-8')
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'",
      );
  }

  private hostAllowed(host: string | undefined): boolean {
    if (!host) return false;
    const allowed = new Set([
      `127.0.0.1:${this.port}`,
      `localhost:${this.port}`,
      `[::1]:${this.port}`,
    ]);
    return allowed.has(host.toLowerCase());
  }

  private originAllowed(origin: string | undefined): boolean {
    if (origin === undefined) return true; // non-browser clients (curl, tests)
    const allowed = new Set([
      `http://127.0.0.1:${this.port}`,
      `http://localhost:${this.port}`,
      `http://[::1]:${this.port}`,
    ]);
    return allowed.has(origin.toLowerCase());
  }

  private sessionFrom(req: IncomingMessage): ConsoleSession | undefined {
    const cookies = parseCookies(req.headers.cookie);
    const id = cookies.get('lam_trace_session');
    if (!id) return undefined;
    const session = this.sessions.get(id);
    if (!session || Date.now() - session.at > SESSION_TTL_MS) {
      this.sessions.delete(id);
      return undefined;
    }
    return session;
  }

  /** Merges one peer sighting into the in-memory node table. The source only
   * ever upgrades along task > pairing > pending > discovered; addresses are
   * the already-redacted ones from the Gateway rows. */
  private observePeer(rawPeer: unknown, source: NodeSource, addresses: readonly string[] = []): void {
    if (typeof rawPeer !== 'string' || !IDENTIFIER.test(rawPeer)) return;
    const existing = this.knownPeers.get(rawPeer);
    if (!existing) {
      this.knownPeers.set(rawPeer, { addresses: [...addresses], source, lastProbe: null });
      return;
    }
    if (SOURCE_RANK[source] > SOURCE_RANK[existing.source]) existing.source = source;
    if (addresses.length && existing.addresses.join('\u0000') !== addresses.join('\u0000'))
      existing.addresses = [...addresses];
  }

  /** One registry round-trip: success proves paired + reachable; the Gateway
   * answering permission_denied proves unpaired/unreachable. Failures are
   * swallowed into the probe record — they must never fail /api/overview. */
  private async probePeer(peer: string): Promise<void> {
    const entry = this.knownPeers.get(peer);
    if (!entry) return;
    try {
      await this.reader.command('registry', { peer });
      entry.lastProbe = { online: true, trusted: true, at: Date.now() };
    } catch (error) {
      entry.lastProbe = {
        online: false,
        trusted: error instanceof GatewayError && error.code === 'permission_denied' ? false : null,
        at: Date.now(),
      };
    } finally {
      this.probing.delete(peer);
    }
  }

  /** Probes at most PROBE_BUDGET peers whose last probe is older than
   * PROBE_TTL_MS, rotating through the stale set so every node is eventually
   * covered. The response waits at most PROBE_SOFT_CAP_MS: probes that settle
   * later still write their result for the next poll. */
  private async probeStalePeers(): Promise<void> {
    const now = Date.now();
    const stale = [...this.knownPeers.entries()]
      .filter(
        ([peer, entry]) =>
          !this.probing.has(peer) && (!entry.lastProbe || now - entry.lastProbe.at > PROBE_TTL_MS),
      )
      .map(([peer]) => peer);
    if (!stale.length) return;
    const picked: string[] = [];
    for (let i = 0; i < stale.length && picked.length < PROBE_BUDGET; i++)
      picked.push(stale[(this.probeCursor + i) % stale.length]!);
    this.probeCursor = (this.probeCursor + picked.length) % stale.length;
    for (const peer of picked) this.probing.add(peer);
    const cap = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, PROBE_SOFT_CAP_MS);
      // The cap only bounds how long THIS response waits; it must not hold
      // the event loop open on an otherwise idle console.
      (timer as { unref?(): void }).unref?.();
    });
    await Promise.race([Promise.allSettled(picked.map((peer) => this.probePeer(peer))), cap]);
  }

  private knownNodes(): RedactedNode[] {
    return redactNodes(
      [...this.knownPeers.entries()].map(([peer, entry]) => ({
        peer,
        addresses: entry.addresses,
        source: entry.source,
        online: entry.lastProbe ? entry.lastProbe.online : null,
        trusted: entry.lastProbe ? entry.lastProbe.trusted : null,
      })),
    );
  }

  private async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.stopping) {
      res.writeHead(503).end();
      return;
    }
    // DNS-rebinding / proxy defence: the Host header must name this loopback
    // listener before anything else is looked at.
    if (!this.hostAllowed(req.headers.host)) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden_host' }));
      return;
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
    const isApi = url.pathname.startsWith('/api/');

    if (isApi && !this.originAllowed(req.headers.origin)) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden_origin' }));
      return;
    }

    // One-time login: GET /?t=<token> exchanges the startup token for a
    // SameSite=Strict session cookie pair and is then revoked.
    if (req.method === 'GET' && url.pathname === '/' && url.searchParams.has('t')) {
      const token = url.searchParams.get('t') ?? '';
      if (!this.loginToken || !equalSecret(token, this.loginToken)) {
        this.securityHeaders(res, 'application/json');
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'invalid_login_token' }));
        return;
      }
      for (const [id, session] of this.sessions)
        if (Date.now() - session.at > SESSION_TTL_MS) this.sessions.delete(id);
      if (this.sessions.size >= MAX_SESSIONS) {
        this.securityHeaders(res, 'application/json');
        res.writeHead(429);
        res.end(JSON.stringify({ error: 'too_many_sessions' }));
        return;
      }
      const id = randomBytes(16).toString('hex');
      this.sessions.set(id, { csrf: randomBytes(16).toString('hex'), at: Date.now() });
      this.loginToken = null;
      res.setHeader('Set-Cookie', [
        `lam_trace_session=${id}; HttpOnly; SameSite=Strict; Path=/`,
        `lam_trace_csrf=${this.sessions.get(id)!.csrf}; SameSite=Strict; Path=/`,
      ]);
      res.writeHead(302, { Location: '/' });
      res.end();
      return;
    }

    const session = this.sessionFrom(req);
    if (!session) {
      if (url.pathname === '/' && req.method === 'GET') {
        this.securityHeaders(res, 'text/plain; charset=utf-8');
        res.writeHead(401);
        res.end('LAM 链路观察台：本页面需要会话。请打开服务端启动时打印的一次性登录链接（该链接仅可使用一次）。');
        return;
      }
      this.securityHeaders(res, 'application/json');
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      this.securityHeaders(res, 'text/html; charset=utf-8');
      res.writeHead(200);
      res.end(PAGE_HTML);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/app.js') {
      this.securityHeaders(res, 'text/javascript; charset=utf-8');
      res.writeHead(200);
      res.end(PAGE_JS);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/app.css') {
      this.securityHeaders(res, 'text/css; charset=utf-8');
      res.writeHead(200);
      res.end(PAGE_CSS);
      return;
    }

    if (!isApi) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    // Known GET routes answer 405 to other methods; anything else — including
    // every mutating proxy name an attacker might guess — is simply not a
    // route on this server and returns 404.
    const knownGetRoutes = new Set(['/api/overview', '/api/task', '/api/export']);
    if (knownGetRoutes.has(url.pathname) && req.method !== 'GET') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }

    if (url.pathname === '/api/overview') {
      const [status, peers, sessions, diagnostics, outbox, pairings] = await Promise.all([
        this.reader.command('status').catch((error: unknown) => error),
        this.reader.command('peers').catch((error: unknown) => error),
        this.reader.command('sessions').catch((error: unknown) => error),
        this.reader.command('diagnostics').catch((error: unknown) => error),
        this.reader.command('outbox').catch((error: unknown) => error),
        this.reader.command('pairings').catch((error: unknown) => error),
      ]);
      const failure = [status, peers, sessions, diagnostics, outbox, pairings].find(
        (result) => result instanceof GatewayError,
      );
      const peerRows = peers instanceof GatewayError ? [] : redactPeers(peers);
      const pairingRows = pairings instanceof GatewayError ? [] : redactPairings(pairings);
      const pendingRows = outbox instanceof GatewayError ? [] : redactPending(outbox);
      // Merge every legitimate peer sighting into the node table before
      // probing, then run the throttled registry probes so the response can
      // carry fresh online states. Probe failures never fail the overview.
      for (const row of peerRows) this.observePeer(row.peer, 'discovered', row.addresses);
      for (const row of pairingRows) this.observePeer(row.peer, 'pairing');
      for (const row of pendingRows) this.observePeer(row.peer, 'pending');
      await this.probeStalePeers();
      this.securityHeaders(res, 'application/json');
      res.writeHead(200);
      res.end(
        JSON.stringify({
          ok: !failure,
          ...(failure instanceof GatewayError ? { error: failure.code } : {}),
          status: status instanceof GatewayError ? null : redactStatus(status),
          peers: peers instanceof GatewayError ? null : peerRows,
          sessions: sessions instanceof GatewayError ? null : redactSessions(sessions),
          diagnostics: diagnostics instanceof GatewayError ? null : redactDiagnostics(diagnostics),
          pending: outbox instanceof GatewayError ? null : pendingRows,
          pairings: pairings instanceof GatewayError ? null : pairingRows,
          nodes: this.knownNodes(),
          fetchedAt: new Date().toISOString(),
        }),
      );
      return;
    }

    if (url.pathname === '/api/task') {
      const peer = url.searchParams.get('peer') ?? '';
      const taskId = url.searchParams.get('taskId') ?? '';
      const cursor = Number(url.searchParams.get('cursor') ?? '0');
      if (!IDENTIFIER.test(peer) || !IDENTIFIER.test(taskId) || !Number.isInteger(cursor) || cursor < 0 || cursor > 4096) {
        this.securityHeaders(res, 'application/json');
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'invalid_arguments' }));
        return;
      }
      // A task this page actively watches is the strongest signal that a peer
      // matters; it enters the node table at the highest source priority.
      this.observePeer(peer, 'task');
      // Locally-received tasks (this node is the receiver, not the caller)
      // have no loopback read interface on the Gateway; do not pretend.
      const local = await this.reader.command('status').catch(() => null) as { nodeId?: string } | null;
      if (local && local.nodeId === peer) {
        this.securityHeaders(res, 'application/json');
        res.writeHead(200);
        res.end(
          JSON.stringify({
            ok: false,
            notObservable: true,
            reason: '该任务由本节点接收：网关环回接口不暴露此类任务（V0 边界：仅提供发起方事件）。',
          }),
        );
        return;
      }
      try {
        const result = await this.reader.command('events', { peer, taskId, cursor });
        const redacted = redactEvents(
          result as { state: string; events: unknown[]; next: number },
          cursor,
        );
        this.securityHeaders(res, 'application/json');
        res.writeHead(200);
        res.end(
          JSON.stringify({
            ok: true,
            ...redacted,
            terminal: TERMINAL_STATES.has(redacted.state),
            observedAt: new Date().toISOString(),
            source: 'remote-task-events via encrypted mesh, read by the local Gateway (cursor-ordered)',
          }),
        );
      } catch (error) {
        this.securityHeaders(res, 'application/json');
        res.writeHead(200);
        res.end(
          JSON.stringify({
            ok: false,
            notObservable: true,
            error: error instanceof GatewayError ? error.code : 'internal',
            observedAt: new Date().toISOString(),
          }),
        );
      }
      return;
    }

    if (url.pathname === '/api/export') {
      const peer = url.searchParams.get('peer') ?? '';
      const taskId = url.searchParams.get('taskId') ?? '';
      if (!IDENTIFIER.test(peer) || !IDENTIFIER.test(taskId)) {
        this.securityHeaders(res, 'application/json');
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'invalid_arguments' }));
        return;
      }
      const startedAt = Date.now();
      const events: unknown[] = [];
      let cursor = 0;
      let state = 'UNKNOWN';
      let truncated = false;
      try {
        while (events.length < EXPORT_EVENT_LIMIT && Date.now() - startedAt < EXPORT_TIME_BUDGET_MS) {
          const result = (await this.reader.command('events', { peer, taskId, cursor })) as {
            state: string;
            events: unknown[];
            next: number;
          };
          state = result.state;
          for (const event of result.events) events.push(event);
          if (result.next === cursor) break;
          cursor = result.next;
        }
        truncated = events.length >= EXPORT_EVENT_LIMIT;
      } catch (error) {
        this.securityHeaders(res, 'application/json');
        res.writeHead(200);
        res.end(
          JSON.stringify({
            ok: false,
            error: error instanceof GatewayError ? error.code : 'internal',
          }),
        );
        return;
      }
      const body = JSON.stringify(
        {
          taskId,
          peer,
          state,
          truncated,
          exportedAt: new Date().toISOString(),
          redaction: 'field whitelist + text redaction applied',
          events: events.map((event, index) => redactEvents({ state, events: [event], next: index + 1 }, index).events[0]),
        },
        null,
        2,
      );
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="lam-trace-${taskId}-redacted.json"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      });
      res.end(body + '\n');
      return;
    }

    if (url.pathname === '/api/reconnect') {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'method_not_allowed' }));
        return;
      }
      // Double-submit CSRF: the non-HttpOnly cookie value must be echoed in
      // the header; SameSite=Strict alone does not cover every legacy case.
      const cookies = parseCookies(req.headers.cookie);
      const header = req.headers['x-lam-csrf'];
      if (typeof header !== 'string' || !equalSecret(header, cookies.get('lam_trace_csrf') ?? '')) {
        this.securityHeaders(res, 'application/json');
        res.writeHead(403);
        res.end(JSON.stringify({ error: 'csrf_required' }));
        return;
      }
      try {
        await this.reader.reattach(this.options.directory);
        this.securityHeaders(res, 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        this.securityHeaders(res, 'application/json');
        res.writeHead(200);
        res.end(
          JSON.stringify({ ok: false, error: error instanceof GatewayError ? error.code : 'internal' }),
        );
      }
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  }
}

export { GatewayError };
