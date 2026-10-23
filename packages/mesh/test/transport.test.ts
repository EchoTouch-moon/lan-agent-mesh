import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { afterEach, it, expect, vi } from 'vitest';
import { lpStream } from '@libp2p/utils';
import { peerIdFromString } from '@libp2p/peer-id';
import { Store } from '@lam/storage';
import { Mesh, manualAddress } from '../src/index.js';
const peers: Mesh[] = [],
  stores: Store[] = [],
  roots: string[] = [];
afterEach(async () => {
  for (const p of peers.splice(0)) await p.stop();
  for (const s of stores.splice(0)) s.close();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
async function create() {
  const directory = mkdtempSync(join(tmpdir(), 'lam-transport '));
  roots.push(directory);
  const store = new Store(join(directory, 'data.sqlite'));
  stores.push(store);
  const mesh = new Mesh({ directory, store, onMessage: async () => ({ private: true }) });
  await mesh.start();
  peers.push(mesh);
  return mesh;
}
it('binds pairing to identity/session, expires short-lived codes and refuses oversized encrypted frames', async () => {
  const a = await create(),
    b = await create();
  expect(manualAddress('127.0.0.1:1234')).toBe('/ip4/127.0.0.1/tcp/1234');
  expect(() => manualAddress('host:0')).toThrow();
  await expect(a.beginPairing(b.addresses[0]!, a.id)).rejects.toMatchObject({
    code: 'permission_denied',
  });
  const address = b.addresses[0]!.split('/');
  const plaintext = createConnection({ host: address[2]!, port: Number(address[4]) });
  plaintext.on('error', () => {});
  const plaintextClosed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      plaintext.destroy();
      reject(new Error('Plaintext connection was not rejected'));
    }, 3500);
    plaintext.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  plaintext.write('plaintext task.request without Noise');
  try {
    await plaintextClosed;
  } finally {
    plaintext.destroy();
  }
  const p = await a.beginPairing(b.addresses[0]!);
  await expect(
    a.rpc(b.id, 'pair.confirm', { id: '00000000-0000-4000-8000-000000000000' }),
  ).rejects.toMatchObject({ code: 'permission_denied' });
  await expect(a.rpc(b.id, 'mesh', { kind: 'registry' })).rejects.toMatchObject({
    code: 'permission_denied',
  });
  await expect(a.rpc(b.id, 'mesh', { blob: 'x'.repeat(70000) })).rejects.toMatchObject({
    code: 'message_too_large',
  });
  const stream = await a.node.dialProtocol(peerIdFromString(b.id), '/lan-agent-mesh/rpc/1.0.0');
  const closed = once(stream, 'close');
  const lp = lpStream(stream, { maxDataLength: 100000 });
  await lp.write(new Uint8Array(70000));
  await closed;
  expect(b.trusted(a.id)).toBe(false);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120001);
  try {
    await expect(a.confirmPairing(p.id, p.code)).rejects.toMatchObject({
      code: 'permission_denied',
    });
  } finally {
    clock.mockRestore();
  }
  expect(p.code).toMatch(/^[a-f0-9]{4}(-[a-f0-9]{4}){5}$/);
});
