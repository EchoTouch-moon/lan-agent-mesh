import { readFileSync, lstatSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { privateFile } from '@lam/private-storage';
import { credential } from '@lam/mcp-contract';
import { createMeshMcpServer } from './index.js';

try {
  const { values } = parseArgs({ options: { credentials: { type: 'string' } } });
  if (!values.credentials) throw new Error('missing_credential_file');
  const lease = await privateFile(values.credentials);
  let config;
  try {
    lease.assertActive();
    const stat = lstatSync(values.credentials);
    if (!stat.isFile() || stat.size > 4096) throw new Error('invalid_credential_file');
    if (
      process.platform !== 'win32' &&
      ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
    )
      throw new Error('credential_file_must_be_private');
    config = credential(JSON.parse(readFileSync(values.credentials, 'utf8')));
  } finally { await lease.close(); }
  const handle = serveStdio(() => createMeshMcpServer(config), {
    transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 65536 }),
    onerror: () => process.stderr.write('MCP transport error\n'),
  });
  const stop = () => {
    void handle.close();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch {
  process.stderr.write('Cannot start LAM MCP: select a valid private scoped credential file.\n');
  process.exitCode = 1;
}
