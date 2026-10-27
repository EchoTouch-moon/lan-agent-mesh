import { describe, expect, it } from 'vitest';
import {
  redactText,
  redactAddress,
  redactEvent,
  redactEvents,
  redactSessions,
  redactStatus,
  redactPending,
  redactNodes,
} from '../src/redact.js';

describe('redactText', () => {
  it('masks bearer/authorization credentials and long hex tokens', () => {
    expect(redactText('Authorization: Bearer abc123def456ghi789')).not.toContain('abc123def456ghi789');
    expect(redactText('token=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).not.toMatch(/[a-f0-9]{64}/i);
    expect(redactText('api-key: AKIAIOSFODNN7EXAMPLE123')).toContain('[REDACTED:credential]');
  });
  it('masks non-loopback IPs but keeps loopback', () => {
    expect(redactText('peer at 192.168.1.23 and 10.0.0.5')).not.toContain('192.168.1.23');
    expect(redactText('peer at 192.168.1.23 and 10.0.0.5')).not.toContain('10.0.0.5');
    expect(redactText('loopback 127.0.0.1 stays')).toContain('127.0.0.1');
  });
  it('masks private absolute paths', () => {
    expect(redactText('log at /Users/alice/secret.txt')).not.toContain('/Users/alice');
    expect(redactText('C:\\Users\\bob\\key.pem')).not.toContain('bob');
  });
  it('leaves ordinary task text intact', () => {
    expect(redactText('hello trace world 42 (ok)')).toBe('hello trace world 42 (ok)');
  });
});

describe('redactAddress', () => {
  it('keeps multiaddr structure but masks LAN addresses', () => {
    const out = redactAddress('/ip4/192.168.1.9/tcp/4001/ipfs/12D3KooPabc');
    expect(out).toContain('[REDACTED:ip]');
    expect(out).toContain('12D3KooPabc');
    expect(out).toContain('/tcp/4001');
  });
});

describe('redactEvent', () => {
  it('projects delta events with a bounded preview', () => {
    const out = redactEvent({ type: 'delta', taskId: 't1', text: 'chunk 1' }, 3);
    expect(out).toMatchObject({ seq: 3, type: 'delta', taskId: 't1', preview: 'chunk 1' });
  });
  it('keeps failed code and unknown reason redacted', () => {
    expect(redactEvent({ type: 'failed', taskId: 't1', code: 'permission_denied' }, 0).code).toBe('permission_denied');
    const unknown = redactEvent({ type: 'unknown', taskId: 't1', reason: 'at /Users/x/ gone' }, 0);
    expect(unknown.preview).not.toContain('/Users');
  });
  it('whitelists permission request fields and drops unknown fields by count only', () => {
    const out = redactEvent(
      {
        type: 'permission',
        taskId: 't1',
        request: { requestId: '8b5a1050-0000-4000-8000-000000000000', operationDigest: 'a'.repeat(64), expiresAt: '2026-01-01T00:00:00Z', nonce: 'n' },
      },
      0,
    );
    expect(out.permission).toBeDefined();
    expect(out.permission!.requestId).toBe('8b5a1050-0000-4000-8000-000000000000');
    expect((out.permission as unknown as Record<string, unknown>).nonce).toBeUndefined();
    expect(out.droppedCount).toBe(0);
    const dirty = redactEvent({ type: 'delta', taskId: 't1', text: 'x', evil: 'value' }, 0);
    expect(dirty.droppedCount).toBe(1);
    expect(JSON.stringify(dirty)).not.toContain('evil');
  });

  it('never echoes ANY unknown field name, hostile or grammar-valid', () => {
    const evilName = '/Users/alice/.ssh/id_rsa=<script>alert(1)</script> ' + 'x'.repeat(200);
    const hexShapedKey = 'a'.repeat(40); // grammar-valid 40-hex token shape
    const secretShapedKey = 'secret_abcd12345678901234567890';
    const bearerShapedKey = 'bearer_0123456789abcdef0123456789abcdef';
    const out = redactEvent(
      { type: 'delta', taskId: 't1', [evilName]: 1, [hexShapedKey]: 1, [secretShapedKey]: 1, [bearerShapedKey]: 1 },
      0,
    );
    const serialized = JSON.stringify(out);
    expect(out.droppedCount).toBe(4);
    expect(serialized).not.toContain('/Users/alice');
    expect(serialized).not.toContain('<script>');
    expect(serialized).not.toContain(hexShapedKey);
    expect(serialized).not.toContain('secret_abcd');
    expect(serialized).not.toContain('bearer_0123');
    // The count-only contract holds through the events projection used by
    // both the page API and the JSON export.
    const projected = redactEvents({ state: 'RUNNING', events: [{ type: 'delta', taskId: 't1', [hexShapedKey]: 1 }], next: 1 }, 0);
    expect(JSON.stringify(projected)).not.toContain(hexShapedKey);
    expect(projected.events[0]!.droppedCount).toBe(1);
  });

  it('withholds identifiers that fail the wire grammar (overlong, markup, path-like)', () => {
    const out = redactEvent(
      {
        type: 'delta',
        taskId: 'bad id\nwith spaces and <img src=x>',
        request: { requestId: 'not-a-uuid', operationDigest: 'zz'.repeat(32), expiresAt: 'x'.repeat(500) },
      },
      0,
    );
    expect(out.taskId).toBeUndefined();
    expect(out.permission).toBeUndefined();
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('<img');
    // Overlong free-text is truncated in previews.
    const long = redactEvent({ type: 'completed', taskId: 't1', text: 'y'.repeat(1000) }, 0);
    expect(long.preview!.length).toBeLessThanOrEqual(420);
    expect(long.preview).toContain('[truncated]');
  });
});

describe('redactEvents', () => {
  it('preserves cursor ordering and state', () => {
    const out = redactEvents({ state: 'RUNNING', events: [{ type: 'delta', taskId: 't', text: 'a' }], next: 7 }, 6);
    expect(out.events[0]!.seq).toBe(6);
    expect(out.next).toBe(7);
    expect(out.state).toBe('RUNNING');
  });
});

describe('redactSessions', () => {
  it('never forwards nativeSessionId and reports the omission', () => {
    const out = redactSessions([
      { id: 's1', nodeId: 'n', agentId: 'a', nativeSessionId: 'native-thread-999', workspaceAlias: 'project-a', state: 'idle', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    expect(JSON.stringify(out)).not.toContain('native-thread-999');
    expect(out[0]!.redactedFields).toEqual(['nativeSessionId']);
    expect(out[0]!.id).toBe('s1');
  });
});

describe('redactStatus / redactPending', () => {
  it('masks LAN addresses in status', () => {
    const out = redactStatus({ nodeId: '12D3', fingerprint: 'f'.repeat(64), addresses: ['/ip4/172.16.0.4/tcp/4001'], controlUrl: 'http://127.0.0.1:5123' });
    expect(out.addresses[0]).not.toContain('172.16.0.4');
    expect(out.controlUrl).toBe('http://127.0.0.1:5123');
  });
  it('projects only envelope discovery fields from outbox rows', () => {
    const out = redactPending([
      { id: 'm1', peer: '12D3', message: { type: 'task.request', taskId: 't9', deadline: '2026-01-01T00:00:00Z', payload: { text: 'secret prompt', sessionId: 's' } } },
    ]);
    expect(out[0]).toMatchObject({ messageId: 'm1', peer: '12D3', type: 'task.request', taskId: 't9' });
    expect(JSON.stringify(out)).not.toContain('secret prompt');
  });
});

describe('redactNodes', () => {
  it('keeps probe states, re-validates ids and re-masks addresses', () => {
    const out = redactNodes([
      { peer: '12D3KooPabc', addresses: ['/ip4/192.168.1.9/tcp/4001'], source: 'discovered', online: true, trusted: true },
      { peer: '12D3KooPdef', addresses: [], source: 'task', online: false, trusted: null },
    ]);
    expect(out[0]).toMatchObject({ peer: '12D3KooPabc', source: 'discovered', online: true, trusted: true });
    expect(out[0]!.addresses[0]).toContain('[REDACTED:ip]');
    expect(out[1]).toMatchObject({ peer: '12D3KooPdef', source: 'task', online: false, trusted: null });
  });
  it('degrades malformed entries instead of echoing them', () => {
    const out = redactNodes([
      { peer: 'bad peer!<img>', source: 'weird', online: 'yes', trusted: 1, addresses: 'not-a-list' },
    ]);
    expect(out[0]!.peer).toBe('[unknown]');
    expect(out[0]!.source).toBe('discovered');
    expect(out[0]!.online).toBeNull();
    expect(out[0]!.trusted).toBeNull();
    expect(out[0]!.addresses).toEqual([]);
    expect(JSON.stringify(out)).not.toContain('<img');
    expect(redactNodes(null)).toEqual([]);
  });
});
