import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey, peerIdFromString } from '@libp2p/peer-id';
import { createLibp2p } from 'libp2p';
import type { Libp2p, PrivateKey } from '@libp2p/interface';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { mdns } from '@libp2p/mdns';
import { lpStream } from '@libp2p/utils';
import { multiaddr } from '@multiformats/multiaddr';
import { z } from 'zod';
import { MeshError, MAX_MESSAGE_BYTES, ErrorCodeSchema } from '@lam/protocol';
import { Store } from '@lam/storage';

const PROTOCOL = '/lan-agent-mesh/rpc/1.0.0';
const Wire = z
  .object({
    id: z.string().uuid(),
    method: z.enum(['pair.open', 'pair.confirm', 'mesh']),
    body: z.unknown(),
  })
  .strict();
const Addresses = z.array(z.string().max(512)).max(8);
const PairOpen = z
  .object({ nonce: z.string().regex(/^[a-f0-9]{64}$/), addresses: Addresses })
  .strict();
const PairConfirm = z.object({ id: z.string().uuid() }).strict();
const PairReply = z
  .object({
    id: z.string().uuid(),
    nonce: z.string().regex(/^[a-f0-9]{64}$/),
    peer: z.string(),
    addresses: Addresses,
  })
  .strict();
export interface Pairing {
  id: string;
  peer: string;
  code: string;
  expires: number;
  localConfirmed: boolean;
  remoteConfirmed: boolean;
}
interface Trust {
  peer: string;
  trusted: boolean;
  pairedAt: string;
  addresses: string[];
}
export interface DiscoveredPeer {
  peer: string;
  addresses: string[];
  expires: number;
}
export interface MeshOptions {
  directory: string;
  assertPrivate?: () => void;
  store: Store;
  listen?: string[];
  mdns?: boolean;
  onMessage: (peer: string, body: unknown) => Promise<unknown>;
}
function encode(value: unknown): Uint8Array {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > MAX_MESSAGE_BYTES)
    throw new MeshError('message_too_large', 'Frame exceeds 64 KiB');
  return bytes;
}
function decode(value: Uint8Array): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value));
}
export function manualAddress(address: string): string {
  if (address.startsWith('/')) {
    multiaddr(address);
    return address;
  }
  const match = /^([a-zA-Z0-9.-]+):(\d+)$/.exec(address);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535)
    throw new MeshError('invalid_message', 'Use host:port or a multiaddr');
  return `/${/^\d+\.\d+\.\d+\.\d+$/.test(match[1]!) ? 'ip4' : 'dns4'}/${match[1]}/tcp/${match[2]}`;
}
export class Mesh {
  node!: Libp2p;
  private privateKey!: PrivateKey;
  private readonly pairs = new Map<string, Pairing>();
  private readonly discoveries = new Map<string, DiscoveredPeer>();
  private readonly rates = new Map<string, { at: number; count: number }>();
  private readonly endpoints = new Map<string, string[]>();
  private inFlight = 0;
  private stopped = false;
  constructor(readonly options: MeshOptions) {}
  get id() {
    return this.node.peerId.toString();
  }
  get fingerprint() {
    return createHash('sha256').update(this.privateKey.publicKey.raw).digest('hex');
  }
  get addresses() {
    return this.node.getMultiaddrs().map((a) => a.toString());
  }
  trusted(peer: string): boolean {
    return this.options.store.get<Trust>('nodes', peer)?.trusted === true;
  }
  peers(): DiscoveredPeer[] {
    const now = Date.now();
    for (const [id, p] of this.discoveries) if (p.expires <= now) this.discoveries.delete(id);
    return [...this.discoveries.values()].map((p) => structuredClone(p));
  }
  pendingPairings(): Pairing[] {
    for (const [id, p] of this.pairs)
      if (p.expires <= Date.now()) {
        this.pairs.delete(id);
        if (!this.trusted(p.peer)) this.endpoints.delete(p.peer);
      }
    return [...this.pairs.values()].map((p) => ({ ...p }));
  }
  async start() {
    this.options.assertPrivate?.();
    mkdirSync(this.options.directory, { recursive: true, mode: 0o700 });
    const file = join(this.options.directory, 'identity.key');
    try {
      this.privateKey = privateKeyFromProtobuf(readFileSync(file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.privateKey = await generateKeyPair('Ed25519');
      this.options.assertPrivate?.();
      writeFileSync(file, privateKeyToProtobuf(this.privateKey), { mode: 0o600, flag: 'wx' });
    }
    chmodSync(file, 0o600);
    this.node = await createLibp2p({
      start: false,
      privateKey: this.privateKey,
      addresses: { listen: this.options.listen ?? ['/ip4/127.0.0.1/tcp/0'] },
      transports: [tcp()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: this.options.mdns
        ? [mdns({ serviceTag: '_lam._udp.local', interval: 20000 })]
        : [],
      connectionManager: {
        maxConnections: 32,
        maxIncomingPendingConnections: 16,
        inboundUpgradeTimeout: 2000,
      },
    });
    this.node.addEventListener('peer:discovery', (event) => {
      this.peers();
      if (this.discoveries.size >= 128 && !this.discoveries.has(event.detail.id.toString())) return;
      this.discoveries.set(event.detail.id.toString(), {
        peer: event.detail.id.toString(),
        addresses: event.detail.multiaddrs.map((a) => a.toString()),
        expires: Date.now() + 120000,
      });
    });
    await this.node.handle(
      PROTOCOL,
      async (stream, connection) => {
        const peer = connection.remotePeer.toString();
        if (this.stopped || this.inFlight >= 16) {
          stream.abort(new Error('Capacity exceeded'));
          return;
        }
        this.inFlight++;
        try {
          this.rate(peer);
          const lp = lpStream(stream, { maxDataLength: MAX_MESSAGE_BYTES });
          const request = Wire.parse(
            decode((await lp.read({ signal: AbortSignal.timeout(10000) })).subarray()),
          );
          let result: unknown;
          try {
            result = {
              id: request.id,
              ok: true,
              body: await this.handle(peer, request.method, request.body),
            };
          } catch (error) {
            result = {
              id: request.id,
              ok: false,
              code: error instanceof MeshError ? error.code : 'invalid_message',
            };
          }
          await lp.write(encode(result), { signal: AbortSignal.timeout(10000) });
          await stream.close({ signal: AbortSignal.timeout(1000) });
        } catch {
          stream.abort(new Error('Invalid, expired or oversized frame'));
        } finally {
          this.inFlight--;
        }
      },
      { maxInboundStreams: 8, maxOutboundStreams: 8 },
    );
    try {
      await this.node.start();
    } catch (e) {
      await this.node.stop();
      throw e;
    }
    if (peerIdFromPrivateKey(this.privateKey).toString() !== this.id)
      throw new Error('Identity mismatch');
  }
  private rate(peer: string) {
    const now = Date.now();
    for (const [id, r] of this.rates) if (now - r.at >= 60000) this.rates.delete(id);
    const r = this.rates.get(peer) ?? { at: now, count: 0 };
    if (r.count >= 240 || this.rates.size >= 1024) throw new MeshError('busy', 'Rate limit');
    r.count++;
    this.rates.set(peer, r);
  }
  private async handle(peer: string, method: string, body: unknown): Promise<unknown> {
    if (method === 'pair.open') {
      const input = PairOpen.parse(body);
      this.pendingPairings();
      if (this.pairs.size >= 16 || [...this.pairs.values()].some((p) => p.peer === peer))
        throw new MeshError('busy', 'Pairing already pending');
      this.endpoints.set(peer, input.addresses);
      const nonce = randomBytes(32).toString('hex'),
        id = randomUUID();
      this.pairs.set(id, {
        id,
        peer,
        code: this.code(id, peer, input.nonce, nonce),
        expires: Date.now() + 120000,
        localConfirmed: false,
        remoteConfirmed: false,
      });
      return { id, nonce, peer: this.id, addresses: this.addresses.slice(0, 8) };
    }
    if (method === 'pair.confirm') {
      const p = this.pair(PairConfirm.parse(body).id);
      if (p.peer !== peer) throw new MeshError('permission_denied', 'Pairing peer mismatch');
      p.remoteConfirmed = true;
      this.persistTrust(p);
      return { confirmed: p.localConfirmed };
    }
    if (!this.trusted(peer)) throw new MeshError('permission_denied', 'Peer is not paired');
    return this.options.onMessage(peer, body);
  }
  private code(id: string, peer: string, initiatorNonce: string, responderNonce: string) {
    return createHash('sha256')
      .update(JSON.stringify([id, ...[this.id, peer].sort(), initiatorNonce, responderNonce]))
      .digest('hex')
      .slice(0, 24)
      .match(/.{4}/g)!
      .join('-');
  }
  private pair(id: string) {
    const p = this.pairs.get(id);
    if (!p || p.expires <= Date.now()) {
      this.pairs.delete(id);
      throw new MeshError('permission_denied', 'Pairing expired or missing');
    }
    return p;
  }
  private persistTrust(p: Pairing) {
    if (p.localConfirmed && p.remoteConfirmed) {
      if (!this.trusted(p.peer) && this.options.store.list('nodes').length >= 128)
        throw new MeshError('busy', 'Trusted peer capacity reached');
      this.options.store.put('nodes', p.peer, {
        peer: p.peer,
        trusted: true,
        pairedAt: new Date().toISOString(),
        addresses: this.endpoints.get(p.peer) ?? [],
      });
      this.options.store.audit('peer.paired', p.peer);
    }
  }
  async beginPairing(address: string, expectedPeer?: string): Promise<Pairing> {
    const connection = await this.node.dial(multiaddr(manualAddress(address)), {
      signal: AbortSignal.timeout(10000),
    });
    const peer = connection.remotePeer.toString();
    if (expectedPeer && expectedPeer !== peer) {
      await connection.close();
      throw new MeshError('permission_denied', 'Unexpected peer identity');
    }
    const nonce = randomBytes(32).toString('hex');
    const reply = PairReply.parse(
      await this.rpc(peer, 'pair.open', { nonce, addresses: this.addresses.slice(0, 8) }),
    );
    if (reply.peer !== peer) throw new MeshError('permission_denied', 'Identity mismatch');
    this.endpoints.set(peer, reply.addresses);
    const p = {
      id: reply.id,
      peer,
      code: this.code(reply.id, peer, nonce, reply.nonce),
      expires: Date.now() + 120000,
      localConfirmed: false,
      remoteConfirmed: false,
    };
    this.pairs.set(p.id, p);
    return { ...p };
  }
  async confirmPairing(id: string, code: string): Promise<boolean> {
    const p = this.pair(id);
    if (p.code !== code) throw new MeshError('permission_denied', 'Pairing code mismatch');
    p.localConfirmed = true;
    const reply = z
      .object({ confirmed: z.boolean() })
      .strict()
      .parse(await this.rpc(p.peer, 'pair.confirm', { id }));
    p.remoteConfirmed ||= reply.confirmed;
    this.persistTrust(p);
    return this.trusted(p.peer);
  }
  async revoke(peer: string) {
    this.options.store.remove('nodes', peer);
    this.endpoints.delete(peer);
    this.options.store.audit('peer.revoked', peer);
    for (const [id, p] of this.pairs) if (p.peer === peer) this.pairs.delete(id);
    await this.node.hangUp(peerIdFromString(peer));
  }
  async connect(address: string, expectedPeer: string) {
    await this.node.hangUp(peerIdFromString(expectedPeer));
    const connection = await this.node.dial(multiaddr(manualAddress(address)), {
      signal: AbortSignal.timeout(10000),
    });
    if (connection.remotePeer.toString() !== expectedPeer) {
      await connection.close();
      throw new MeshError('permission_denied', 'Unexpected peer identity');
    }
    const trust = this.options.store.get<Trust>('nodes', expectedPeer);
    if (trust?.trusted)
      this.options.store.put('nodes', expectedPeer, {
        ...trust,
        addresses: [manualAddress(address)],
      });
  }
  async request(peer: string, body: unknown): Promise<unknown> {
    if (!this.trusted(peer)) throw new MeshError('permission_denied', 'Peer not paired');
    return this.rpc(peer, 'mesh', body);
  }
  /** Application frames remain trust-gated at the receiver, including raw negative tests. */
  async rpc(
    peer: string,
    method: 'pair.open' | 'pair.confirm' | 'mesh',
    body: unknown,
  ): Promise<unknown> {
    const id = randomUUID(),
      data = encode({ id, method, body });
    const stream = await this.node.dialProtocol(peerIdFromString(peer), PROTOCOL, {
      signal: AbortSignal.timeout(10000),
    });
    try {
      const lp = lpStream(stream, { maxDataLength: MAX_MESSAGE_BYTES });
      await lp.write(data, { signal: AbortSignal.timeout(10000) });
      const result = z
        .object({
          id: z.literal(id),
          ok: z.boolean(),
          body: z.unknown().optional(),
          code: ErrorCodeSchema.optional(),
        })
        .strict()
        .parse(decode((await lp.read({ signal: AbortSignal.timeout(10000) })).subarray()));
      if (!result.ok) throw new MeshError(result.code ?? 'internal', 'Remote request rejected');
      return result.body;
    } finally {
      stream.abort(new Error('RPC completed'));
    }
  }
  async reconnectTrusted() {
    for (const trust of this.options.store.list<Trust>('nodes')) {
      if (this.stopped || !trust.trusted || this.connected(trust.peer)) continue;
      for (const address of trust.addresses ?? []) {
        if (this.stopped) break;
        try {
          await this.connect(address, trust.peer);
          break;
        } catch {
          /* Next known endpoint; never change expected identity. */
        }
      }
    }
  }
  connected(peer: string) {
    return this.node.getConnections(peerIdFromString(peer)).length > 0;
  }
  async stop() {
    this.stopped = true;
    if (this.node) await this.node.stop();
  }
}

/** Offline rotation intentionally invalidates trust; no transparent identity replacement. */
export async function rotateIdentity(directory: string, assertPrivate?: () => void) {
  assertPrivate?.();
  const lock = join(directory, 'gateway.lock');
  if (existsSync(lock)) throw new MeshError('busy', 'Stop Gateway before rotating identity');
  writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
  const temporary = join(directory, `identity-${randomUUID()}.tmp`);
  try {
    const original = privateKeyFromProtobuf(readFileSync(join(directory, 'identity.key')));
    const oldPeer = peerIdFromPrivateKey(original).toString();
    const key = await generateKeyPair('Ed25519');
    assertPrivate?.();
    writeFileSync(temporary, privateKeyToProtobuf(key), { mode: 0o600, flag: 'wx' });
    const store = new Store(join(directory, 'mesh.sqlite'));
    // Revoke trust first: a crash between SQLite and rename fails closed.
    try {
      store.transaction(() => {
        for (const peer of store.list<Trust>('nodes')) store.remove('nodes', peer.peer);
        store.audit('identity.rotated', oldPeer);
      });
    } finally {
      store.close();
    }
    renameSync(temporary, join(directory, 'identity.key'));
    return {
      previousPeer: oldPeer,
      peer: peerIdFromPrivateKey(key).toString(),
      requiresPairing: true,
    };
  } finally {
    unlinkSync(lock);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
