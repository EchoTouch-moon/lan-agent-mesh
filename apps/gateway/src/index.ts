import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { Gateway } from '@lam/runtime';
import { rotateIdentity } from '@lam/mesh';
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    data: { type: 'string' },
    listen: { type: 'string' },
    'control-port': { type: 'string' },
    mdns: { type: 'boolean' },
    mock: { type: 'boolean' },
    'mock-delay-ms': { type: 'string' },
    command: { type: 'string' },
    args: { type: 'string' },
    'args-file': { type: 'string' },
    output: { type: 'string' },
    help: { type: 'boolean' },
  },
});
if (values.help || !values.data) {
  console.log(
    'LAM Gateway (Node 22.13+ / 24)\nserve --data <private-directory> [--listen /ip4/0.0.0.0/tcp/port] [--mdns] [--mock]\ncontrol --data <directory> --command <status|peers|pair|pairings|confirm|connect|registry|spawn|resume|send|events|cancel|outbox|retry|revoke|shutdown> [--args <JSON>]\nMCP: control --command mcp-grant --args-file <scope.json> --output <private-file>; revoke with mcp-revoke and grantId.\nDefault listen: random loopback TCP port; control always authenticated loopback. --mock explicitly exports the deterministic test agent.',
  );
  if (!values.help) process.exitCode = 1;
} else {
  const directory = resolve(values.data);
  const action = positionals[0] ?? 'serve';
  if (action === 'rotate-identity') {
    console.log(JSON.stringify(await rotateIdentity(directory)));
  } else if (action === 'control') {
    if (values.command === 'mcp-grant' && !values.output)
      throw new Error(
        'mcp-grant requires --output <private-credential-file>; credentials are never printed',
      );
    const config = JSON.parse(readFileSync(join(directory, 'control.json'), 'utf8')) as {
      url: string;
      token: string;
    };
    const url = new URL(config.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
      throw new Error('Control endpoint must be loopback');
    const response = await fetch(url.origin + '/command', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        command: values.command ?? 'status',
        args: JSON.parse(
          values['args-file']
            ? readFileSync(resolve(values['args-file']), 'utf8')
            : (values.args ?? '{}'),
        ),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (values.command === 'mcp-grant' && response.ok) {
      const output = resolve(values.output!);
      mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
      const credential = (await response.json()) as { grantId: string; expiresAt: string };
      try {
        writeFileSync(output, JSON.stringify(credential, null, 2) + '\n', {
          mode: 0o600,
          flag: 'wx',
        });
      } catch (error) {
        const revoked = await fetch(url.origin + '/command', {
          method: 'POST',
          headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ command: 'mcp-revoke', args: { grantId: credential.grantId } }),
          signal: AbortSignal.timeout(5000),
        })
          .then((r) => r.ok)
          .catch(() => false);
        if (!revoked)
          process.stderr.write(
            'Credential write failed and revocation was not confirmed; restart the caller Gateway before issuing another credential.\n',
          );
        throw error;
      }
      console.log(
        JSON.stringify({
          grantId: credential.grantId,
          expiresAt: credential.expiresAt,
          credentialFileWritten: true,
        }),
      );
    } else {
      console.log(await response.text());
      if (!response.ok) process.exitCode = 1;
    }
  } else if (action === 'serve') {
    const port = Number(values['control-port'] ?? 0),
      delay = Number(values['mock-delay-ms'] ?? 0);
    if (
      !Number.isInteger(port) ||
      port < 0 ||
      port > 65535 ||
      !Number.isInteger(delay) ||
      delay < 0 ||
      delay > 10000
    )
      throw new Error('Invalid port/delay');
    const gateway = await new Gateway({
      directory,
      controlPort: port,
      mock: values.mock ?? false,
      mdns: values.mdns ?? false,
      scenario: { delayMs: delay },
      ...(values.listen ? { listen: [values.listen] } : {}),
    }).start();
    console.log(
      JSON.stringify({
        ready: true,
        nodeId: gateway.mesh.id,
        addresses: gateway.mesh.addresses,
        controlUrl: gateway.url,
      }),
    );
    const stop = () => {
      void gateway.stop().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } else throw new Error('Unknown action');
}
