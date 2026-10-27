// Read-only client for the local Gateway control endpoint. The Gateway admin
// token is read once from the private control.json at startup (or on an
// explicit user reconnect) and never leaves this process: not in responses,
// not in URLs, not in logs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { privateFile } from '@lam/private-storage';

export const READ_ONLY_COMMANDS = [
  'status',
  'peers',
  'sessions',
  'diagnostics',
  'events',
  'outbox',
  'pairings',
] as const;

export type ReadOnlyCommand = (typeof READ_ONLY_COMMANDS)[number];

export class GatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
  }
}

interface ControlConfig {
  url: string;
  token: string;
}

async function readControlConfig(directory: string): Promise<ControlConfig> {
  const file = join(directory, 'control.json');
  const lease = await privateFile(file);
  try {
    lease.assertActive();
    const config = JSON.parse(readFileSync(file, 'utf8')) as ControlConfig;
    if (typeof config.url !== 'string' || typeof config.token !== 'string')
      throw new GatewayError('invalid_message', 'control.json is malformed', 502);
    const url = new URL(config.url);
    // Same invariant as the Gateway CLI: control is authenticated loopback only.
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
      throw new GatewayError('invalid_message', 'Control endpoint is not loopback', 502);
    return config;
  } finally {
    await lease.close();
  }
}

export class GatewayReader {
  private constructor(private config: ControlConfig) {}

  static async attach(directory: string): Promise<GatewayReader> {
    return new GatewayReader(await readControlConfig(directory));
  }

  /** Re-reads control.json after a Gateway restart rotated the admin token. */
  async reattach(directory: string): Promise<void> {
    this.config = await readControlConfig(directory);
  }

  /** Invokes exactly one whitelisted read-only command. Any other name throws
   * before a socket is opened; mutating commands are unreachable by design. */
  async command(command: ReadOnlyCommand, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!(READ_ONLY_COMMANDS as readonly string[]).includes(command))
      throw new GatewayError('permission_denied', 'Command is not in the read-only whitelist', 403);
    let response: Response;
    try {
      response = await fetch(this.config.url + '/command', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.config.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ command, args }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new GatewayError('unreachable', 'Local Gateway control endpoint is unreachable', 502);
    }
    const text = await response.text();
    if (!response.ok) {
      let code = 'unknown';
      try {
        code = (JSON.parse(text) as { code?: string }).code ?? 'unknown';
      } catch {
        // keep code 'unknown'
      }
      throw new GatewayError(code, `Gateway rejected ${command}`, 502);
    }
    return JSON.parse(text);
  }
}
