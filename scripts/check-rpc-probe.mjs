import assert from 'node:assert/strict';
import { rpcProcess } from './rpc-probe.mjs';
import { redactProbeText, startupLogSummary } from './probe-diagnostics.mjs';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const code = `
process.stderr.write('x'.repeat(10000) + ' startup diagnostic');
console.log('non-JSON startup text'); console.log('null');
const lines = require('node:readline').createInterface({input:process.stdin});
lines.on('line', line => {
  const m=JSON.parse(line);
  if(m.method==='initialize') console.log(JSON.stringify({id:m.id,method:'preferences',params:{}}));
  else if(m.result?.replied) console.log(JSON.stringify({id:m.id,result:{ready:true}}));
});`;
let rpc;
rpc = rpcProcess(process.execPath, ['-e', code], process.env, tmpdir(), {
  jsonrpc: false, captureDiagnostics: true,
  onMessage(message) { if (message.method === 'preferences') rpc.reply(message.id, { replied: true }); },
});
try {
  assert.deepEqual(await rpc.call('initialize', {}), { ready: true });
  await assert.rejects(rpc.call('no-reply', {}, { timeoutMs: 30 }), /timed out/);
} finally { await rpc.close(); }
assert.ok(rpc.diagnostics().stderrTail.length <= 8192);
assert.ok(rpc.diagnostics().stderrTail.endsWith('startup diagnostic'));
assert.match(rpc.diagnostics().stdoutTextTail, /non-JSON startup text\nnull/);
const stopped = rpcProcess(process.execPath, ['-e', "process.stderr.write('missing profile');process.exit(1)"], process.env, tmpdir(), { captureDiagnostics: true });
await assert.rejects(stopped.call('initialize', {}), /process exited/);
await stopped.close();
assert.equal(stopped.diagnostics().exit.code, 1);
assert.equal(stopped.diagnostics().stderrTail, 'missing profile');
await assert.rejects(stopped.call('after-exit', {}), /process exited/);
const secretName = 'LAM_PROBE_TEST_TOKEN';
const prior = process.env[secretName];
process.env[secretName] = 'lam-test-token-for-redaction';
try {
  const root = 'C:\\Users\\fixture\\Temp\\probe';
  const redacted = redactProbeText(JSON.stringify({ text: root + ' lam-test-token-for-redaction Bearer abc.def' }), root);
  assert.deepEqual(JSON.parse(redacted), { text: '<probe-or-user-home> <redacted> Bearer <redacted>' });
} finally { if (prior === undefined) delete process.env[secretName]; else process.env[secretName] = prior; }
const logs = await mkdtemp(join(tmpdir(), 'lam-diagnostic-log-check-'));
try {
  await writeFile(join(logs, 'startup.jsonl'), [
    { event: 'zcode_protocol.session_create.started', level: 'info', message: 'Creating sess_12345678-1234-1234-1234-123456789abc', sessionId: 'do-not-copy', context: { prompt: 'do-not-copy', apiKey: 'do-not-copy' } },
    { event: 'model.streaming', level: 'info', message: 'do-not-copy' },
  ].map(item => JSON.stringify(item)).join('\n'));
  const summary = await startupLogSummary(logs, logs);
  assert.equal(summary.length, 1);
  assert.equal(summary[0].message, 'Creating <native-id>');
  assert.ok(!JSON.stringify(summary).includes('do-not-copy'));
} finally { await rm(logs, { recursive: true, force: true }); }
console.log('RPC callback IDs, timeout, exit, bounded diagnostics and redaction passed.');
