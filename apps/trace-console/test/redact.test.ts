import { describe, expect, it } from 'vitest';
import {
  redactText,
  redactAddress,
  redactEvent,
  redactEvents,
  redactSessions,
  redactStatus,
  redactPending,
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
  it('whitelists permission request fields and drops unknown fields with a report', () => {
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
    expect(out.droppedFields).toEqual([]);
    const dirty = redactEvent({ type: 'delta', taskId: 't1', text: 'x', evil: new Map() }, 0);
    expect(dirty.droppedFields).toEqual(['evil']);
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
