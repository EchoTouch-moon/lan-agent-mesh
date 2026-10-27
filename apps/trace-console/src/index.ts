// CLI entry: read-only LAN Mesh trace console (OBS-0 V0).
//
//   node apps/trace-console/dist/index.js --data <gateway-private-directory> [--port <n>]
//
// Reads the Gateway control.json once (via the private-storage lease), serves
// the read-only page on 127.0.0.1 and prints a one-time login URL. The admin
// token never leaves the server process.

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { TraceConsole } from './server.js';

try {
  const { values } = parseArgs({
    options: {
      data: { type: 'string' },
      port: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help || !values.data) {
    console.log(
      'LAM Trace Console (read-only OBS-0 V0)\n' +
        'usage: node dist/index.js --data <gateway-private-directory> [--port <0-65535>]\n' +
        'The Gateway must already be running with control.json in --data. The console\n' +
        'binds 127.0.0.1 only and never calls pair/confirm/spawn/send/cancel/retry/shutdown.',
    );
    if (!values.help) process.exitCode = 1;
  } else {
    const port = Number(values.port ?? 0);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
    const console_ = await TraceConsole.start({ directory: resolve(values.data), port });
    console.log(
      JSON.stringify(
        {
          ready: true,
          listen: `127.0.0.1:${console_.port}`,
          loginUrl: console_.loginUrl,
          note: 'Open the login URL in a local browser once; the token works exactly once.',
        },
        null,
        2,
      ),
    );
    const stop = () => {
      void console_.stop().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
}
