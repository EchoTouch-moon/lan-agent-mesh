// LHI-1 (#80): synthetic read-only MCP server used as the ZCode outbound fixture.
// Modes:
//   --stdio      speak MCP over stdio (this is what the ZCode harness spawns)
//   --self-test  spawn itself over stdio, verify handshake/tools/validation/timeout, exit 0/1
// Tools:
//   probe_echo   {phrase: string} -> "lhi-echo:<phrase>"   (positive control; type violations fail closed)
//   probe_hang   {} -> never settles                        (timeout negative; caller-side timeout is the assertion)
// Every validated invocation is appended as one JSONL line to $LHI_MCP_LOG before any side effect,
// giving a server-side execution count that is independent of harness self-reporting.
import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromMcpServer = createRequire(resolve(repoRoot, 'packages/mcp-server/package.json'));
const { McpServer } = requireFromMcpServer('@modelcontextprotocol/server');
const { StdioServerTransport } = requireFromMcpServer('@modelcontextprotocol/server/stdio');
const { Client } = requireFromMcpServer('@modelcontextprotocol/client');
const { StdioClientTransport } = requireFromMcpServer('@modelcontextprotocol/client/stdio');
// MCP SDK 2.4.0 depends on its own zod 4.x instance (a transitive dep, not linked into
// packages/mcp-server/node_modules); field schemas must come from that same tree or the
// SDK's JSON-schema conversion rejects them as non-representable.
const requireFromSdk = createRequire(requireFromMcpServer.resolve('@modelcontextprotocol/server'));
const z = requireFromSdk('zod');

const logPath = process.env.LHI_MCP_LOG;
function log(entry) {
  if (!logPath) return;
  appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
}

function buildServer(runId) {
  const server = new McpServer({ name: 'lam-lhi', version: '0.0.0' }, { capabilities: { tools: {} } });
  server.registerTool('probe_echo', {
    description: 'LHI-1 positive-control read-only echo tool. Returns "lhi-echo:<phrase>".',
    inputSchema: { phrase: z.string() },
  }, async ({ phrase }) => {
    log({ tool: 'probe_echo', phase: 'invoked', args: { phrase } });
    return { content: [{ type: 'text', text: `lhi-echo:${phrase}` }] };
  });
  server.registerTool('probe_hang', {
    description: 'LHI-1 timeout negative-control tool. Never returns; the caller-side timeout is the assertion.',
    inputSchema: {},
  }, async () => {
    log({ tool: 'probe_hang', phase: 'invoked', args: {} });
    await new Promise(() => {});
  });
  return server;
}

async function stdioMode() {
  const runIdIndex = process.argv.indexOf('--run-id');
  const runId = runIdIndex >= 0 ? process.argv[runIdIndex + 1] : 'unidentified-run';
  // First log line: self-reported identity so the runner can clean up exactly this child
  // (never by shared script name, which could match unrelated concurrent experiments).
  log({ phase: 'startup', pid: process.pid, runId });
  const server = buildServer(runId);
  await server.connect(new StdioServerTransport());
}

async function selfTest() {
  const self = fileURLToPath(import.meta.url);
  const results = {};
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [self, '--stdio'],
    env: { ...process.env, LHI_MCP_LOG: process.env.LHI_MCP_LOG ?? undefined },
    stderr: 'pipe',
    maxBufferSize: 262144,
  });
  transport.stderr?.on('data', () => {});
  const client = new Client({ name: 'lhi-self-test', version: '0.0.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    results.toolsListed = listed.tools.map(tool => tool.name).sort();
    if (!results.toolsListed.includes('probe_echo') || !results.toolsListed.includes('probe_hang'))
      throw new Error(`unexpected tool list: ${results.toolsListed}`);
    const echo = await client.callTool({ name: 'probe_echo', arguments: { phrase: 'selftest' } });
    const echoed = echo.content?.[0]?.text;
    results.echoRoundTrip = echoed === 'lhi-echo:selftest';
    if (!results.echoRoundTrip) throw new Error(`echo mismatch: ${echoed}`);
    // MCP semantics: schema violations surface as a tool result with isError=true (fail-closed),
    // while unknown tools surface as protocol errors. Accept either rejection shape and record it.
    let wrongTypeRejected = false;
    let wrongTypeObserved;
    try {
      const bad = await client.callTool({ name: 'probe_echo', arguments: { phrase: 12345 } });
      wrongTypeObserved = { isError: bad.isError === true, contentPreview: String(bad.content?.[0]?.text ?? '').slice(0, 120) };
      wrongTypeRejected = bad.isError === true;
    } catch (error) {
      wrongTypeObserved = { protocolErrorCode: error.code };
      wrongTypeRejected = error.code === -32602;
    }
    results.wrongTypeParamRejected = wrongTypeRejected;
    results.wrongTypeObserved = wrongTypeObserved;
    if (!wrongTypeRejected) throw new Error(`wrong-typed parameter was not rejected: ${JSON.stringify(wrongTypeObserved)}`);
    let timedOut = false;
    try {
      await Promise.race([
        client.callTool({ name: 'probe_hang', arguments: {} }),
        delay(2000).then(() => { timedOut = true; }),
      ]);
    } catch { /* client transport errors after child kill are acceptable for the self-test */ }
    results.hangNeverReturns = timedOut;
    if (!timedOut) throw new Error('probe_hang returned early; timeout negative control is invalid');
    results.selfTest = 'PASS';
  } catch (error) {
    results.selfTest = 'FAIL';
    results.error = error.message;
  } finally {
    await client.close().catch(() => {});
  }
  console.log(JSON.stringify(results, null, 2));
  process.exitCode = results.selfTest === 'PASS' ? 0 : 1;
}

if (process.argv.includes('--self-test')) await selfTest();
else await stdioMode();
