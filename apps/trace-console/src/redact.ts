// Structured redaction for every value forwarded from the local Gateway to the
// read-only trace console page. Gateway control tokens, bearer credentials,
// non-loopback IPs, absolute private paths and native session IDs must never
// reach the browser, a log line or an exported JSON file.

const CREDENTIAL = /\b(?:bearer|authorization|token|secret|password|api[-_]?key)\s*[:=]?\s*[A-Za-z0-9._~+/=-]{8,}/gi;
const HEX_TOKEN = /\b[a-f0-9]{40,130}\b/gi;
const WINDOWS_PATH = /\b[a-zA-Z]:\\(?:Users|Documents and Settings|home|Windows)\\[^\s"']*/gi;
const POSIX_PATH = /(?:^|[\s"'(=])\/(?:Users|home|private|var|opt)\/[^\s"')]*/g;
const IPV4 = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/g;

function isLoopbackIpv4(value: string): boolean {
  return value.startsWith('127.') || value === '0.0.0.0';
}

/** Redacts credential-shaped substrings, long hex tokens, private absolute
 * paths and non-loopback IPv4 addresses. Loopback addresses stay visible
 * because the console is loopback-only by design. */
export function redactText(input: string): string {
  return input
    .replace(CREDENTIAL, '[REDACTED:credential]')
    .replace(HEX_TOKEN, '[REDACTED:hex-token]')
    .replace(WINDOWS_PATH, '[REDACTED:path]')
    .replace(POSIX_PATH, (match) => match[0] === '/' ? '[REDACTED:path]' : match[0] + '[REDACTED:path]')
    .replace(IPV4, (match) => (isLoopbackIpv4(match) ? match : '[REDACTED:ip]'));
}

/** Multiaddrs such as /ip4/192.168.1.4/tcp/4001 keep their structure but the
 * embedded non-loopback address is masked; peer IDs (base58) are not secret. */
export function redactAddress(address: string): string {
  return redactText(address);
}

const MAX_PREVIEW = 400;

function preview(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined;
  const redacted = redactText(text);
  return redacted.length > MAX_PREVIEW ? redacted.slice(0, MAX_PREVIEW) + '…[truncated]' : redacted;
}

export interface RedactedEvent {
  seq: number;
  type: string;
  taskId?: string | undefined;
  state?: string;
  preview?: string | undefined;
  code?: string | undefined;
  permission?: { requestId: string; operationDigest: string; expiresAt: string } | undefined;
  droppedFields: string[];
}

/** Whitelisted, field-by-field projection of one stored task event. Unknown
 * fields are dropped and reported by name instead of forwarded. */
export function redactEvent(event: unknown, seq: number): RedactedEvent {
  const value = (event ?? {}) as Record<string, unknown>;
  const droppedFields: string[] = [];
  const out: RedactedEvent = { seq, type: '[missing]', droppedFields };
  if (typeof value.type === 'string') out.type = redactText(value.type);
  if (typeof value.taskId === 'string') out.taskId = value.taskId;
  if (typeof value.code === 'string') out.code = redactText(value.code);
  if (typeof value.reason === 'string' && out.preview === undefined) out.preview = preview(value.reason);
  if (typeof value.text === 'string') out.preview = preview(value.text);
  if (value.request && typeof value.request === 'object') {
    const request = value.request as Record<string, unknown>;
    if (typeof request.requestId === 'string' && typeof request.operationDigest === 'string' && typeof request.expiresAt === 'string')
      out.permission = {
        requestId: request.requestId,
        operationDigest: request.operationDigest,
        expiresAt: request.expiresAt,
      };
  }
  const known = new Set(['type', 'taskId', 'text', 'code', 'reason', 'request']);
  for (const key of Object.keys(value)) if (!known.has(key)) droppedFields.push(key);
  return out;
}

export interface RedactedEvents {
  state: string;
  events: RedactedEvent[];
  next: number;
}

export function redactEvents(result: { state: string; events: unknown[]; next: number }, cursor: number): RedactedEvents {
  return {
    state: typeof result.state === 'string' ? result.state : 'UNKNOWN',
    events: result.events.map((event, index) => redactEvent(event, cursor + index)),
    next: result.next,
  };
}

export interface RedactedStatus {
  nodeId?: string | undefined;
  fingerprint?: string | undefined;
  addresses: string[];
  controlUrl?: string | undefined;
}

export function redactStatus(status: unknown): RedactedStatus {
  const value = (status ?? {}) as Record<string, unknown>;
  return {
    nodeId: typeof value.nodeId === 'string' ? value.nodeId : undefined,
    fingerprint: typeof value.fingerprint === 'string' ? value.fingerprint : undefined,
    addresses: Array.isArray(value.addresses) ? value.addresses.map((a) => redactAddress(String(a))) : [],
    controlUrl: typeof value.controlUrl === 'string' ? redactAddress(value.controlUrl) : undefined,
  };
}

export interface RedactedPeer {
  peer: string;
  addresses: string[];
}

export function redactPeers(peers: unknown): RedactedPeer[] {
  if (!Array.isArray(peers)) return [];
  return peers.map((peer) => {
    const value = (peer ?? {}) as Record<string, unknown>;
    return {
      peer: typeof value.peer === 'string' ? value.peer : '[unknown]',
      addresses: Array.isArray(value.addresses) ? value.addresses.map((a) => redactAddress(String(a))) : [],
    };
  });
}

export interface RedactedSession {
  id: string;
  agentId: string;
  workspaceAlias: string;
  state: string;
  createdAt: string;
  redactedFields: string[];
}

/** nativeSessionId identifies a private native harness thread and is never
 * forwarded to the page. */
export function redactSessions(sessions: unknown): RedactedSession[] {
  if (!Array.isArray(sessions)) return [];
  return sessions.map((session) => {
    const value = (session ?? {}) as Record<string, unknown>;
    const redactedFields: string[] = [];
    if ('nativeSessionId' in value) redactedFields.push('nativeSessionId');
    return {
      id: typeof value.id === 'string' ? value.id : '[unknown]',
      agentId: typeof value.agentId === 'string' ? value.agentId : '[unknown]',
      workspaceAlias: typeof value.workspaceAlias === 'string' ? value.workspaceAlias : '[unknown]',
      state: typeof value.state === 'string' ? value.state : '[unknown]',
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : '[unknown]',
      redactedFields,
    };
  });
}

export interface RedactedPending {
  messageId: string;
  peer: string;
  type?: string | undefined;
  taskId?: string | undefined;
  deadline?: string | undefined;
}

/** Outbox rows carry full envelopes; only the fields needed to discover which
 * locally-initiated tasks are still awaiting an ACK are forwarded. */
export function redactPending(pending: unknown): RedactedPending[] {
  if (!Array.isArray(pending)) return [];
  return pending.map((row) => {
    const value = (row ?? {}) as Record<string, unknown>;
    const message = (value.message ?? {}) as Record<string, unknown>;
    const out: RedactedPending = {
      messageId: typeof value.id === 'string' ? value.id : '[unknown]',
      peer: typeof value.peer === 'string' ? value.peer : '[unknown]',
    };
    if (typeof message.type === 'string') out.type = message.type;
    if (typeof message.taskId === 'string') out.taskId = message.taskId;
    if (typeof message.deadline === 'string') out.deadline = message.deadline;
    return out;
  });
}

export function redactDiagnostics(diagnostics: unknown): Record<string, unknown> {
  const value = (diagnostics ?? {}) as Record<string, unknown>;
  const allowed = ['schemaVersion', 'tasks', 'inbox', 'outbox', 'pending', 'mdns', 'approvalPolicy'];
  const out: Record<string, unknown> = {};
  for (const key of allowed) if (key in value) out[key] = value[key];
  return out;
}
