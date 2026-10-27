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

// Untrusted event objects can encode payloads in field NAMES (a key like
// "/Users/x/token=<secret>" or "<script>…"). Only structurally safe names are
// ever echoed back; anything else is counted, not repeated.
const SAFE_FIELD_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_DROPPED_LISTED = 16;
// Identifiers forwarded verbatim must match the wire ID grammar; anything
// else (overlong, spacing, markup, path-like) is withheld.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const SAFE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_DIGEST = /^[a-f0-9]{64}$/i;

function safeId(value: unknown): string | undefined {
  // Wire-grammar check first, then a defence-in-depth text pass: a grammar-
  // valid id can still embed credential-shaped substrings, which get masked
  // (the displayed id degrades instead of leaking).
  if (typeof value !== 'string' || !SAFE_ID.test(value)) return undefined;
  return redactText(value);
}

function safeShort(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const redacted = redactText(value);
  return redacted.length <= max ? redacted : undefined;
}

function preview(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined;
  const redacted = redactText(text);
  return redacted.length > MAX_PREVIEW ? redacted.slice(0, MAX_PREVIEW) + '…[truncated]' : redacted;
}

export interface RedactedEvent {
  seq: number;
  type: string;
  taskId?: string | undefined;
  state?: string | undefined;
  preview?: string | undefined;
  code?: string | undefined;
  permission?: { requestId: string; operationDigest: string; expiresAt: string } | undefined;
  droppedFields: string[];
  droppedUnsafeCount?: number | undefined;
}

/** Whitelisted, field-by-field projection of one stored task event. Unknown
 * fields are dropped; only structurally safe field NAMES are reported, unsafe
 * names are aggregated into droppedUnsafeCount and never echoed. */
export function redactEvent(event: unknown, seq: number): RedactedEvent {
  const value = (event ?? {}) as Record<string, unknown>;
  const droppedFields: string[] = [];
  let droppedUnsafe = 0;
  const out: RedactedEvent = { seq, type: '[missing]', droppedFields };
  const type = safeShort(value.type, 64);
  if (type !== undefined && SAFE_FIELD_NAME.test(type)) out.type = type;
  out.taskId = safeId(value.taskId);
  const code = safeShort(value.code, 128);
  if (code !== undefined) out.code = code;
  if (typeof value.reason === 'string' && out.preview === undefined) out.preview = preview(value.reason);
  if (typeof value.text === 'string') out.preview = preview(value.text);
  if (value.request && typeof value.request === 'object') {
    const request = value.request as Record<string, unknown>;
    const requestId = typeof request.requestId === 'string' && SAFE_UUID.test(request.requestId) ? request.requestId : undefined;
    const operationDigest = typeof request.operationDigest === 'string' && SAFE_DIGEST.test(request.operationDigest) ? request.operationDigest : undefined;
    const expiresAt = safeShort(request.expiresAt, 64);
    if (requestId && operationDigest && expiresAt)
      out.permission = { requestId, operationDigest, expiresAt };
  }
  const known = new Set(['type', 'taskId', 'text', 'code', 'reason', 'request']);
  for (const key of Object.keys(value))
    if (!known.has(key)) {
      if (SAFE_FIELD_NAME.test(key) && droppedFields.length < MAX_DROPPED_LISTED) droppedFields.push(key);
      else droppedUnsafe++;
    }
  if (droppedUnsafe > 0) out.droppedUnsafeCount = droppedUnsafe;
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
    nodeId: safeId(value.nodeId),
    fingerprint: typeof value.fingerprint === 'string' && SAFE_DIGEST.test(value.fingerprint) ? value.fingerprint : undefined,
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
      peer: safeId(value.peer) ?? '[unknown]',
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
 * forwarded to the page. All echoed identifiers pass the wire ID grammar. */
export function redactSessions(sessions: unknown): RedactedSession[] {
  if (!Array.isArray(sessions)) return [];
  return sessions.map((session) => {
    const value = (session ?? {}) as Record<string, unknown>;
    const redactedFields: string[] = [];
    if ('nativeSessionId' in value) redactedFields.push('nativeSessionId');
    return {
      id: safeId(value.id) ?? '[unknown]',
      agentId: safeId(value.agentId) ?? '[unknown]',
      workspaceAlias: safeId(value.workspaceAlias) ?? '[unknown]',
      state: safeShort(value.state, 32) ?? '[unknown]',
      createdAt: safeShort(value.createdAt, 64) ?? '[unknown]',
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
      messageId: safeId(value.id) ?? '[unknown]',
      peer: safeId(value.peer) ?? '[unknown]',
    };
    const type = safeShort(message.type, 64);
    if (type !== undefined && SAFE_FIELD_NAME.test(type)) out.type = type;
    out.taskId = safeId(message.taskId);
    const deadline = safeShort(message.deadline, 64);
    if (deadline !== undefined) out.deadline = deadline;
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
