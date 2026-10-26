// LHI-1 (#80): native ZCode MCP outbound smoke. Runs the installed ZCode bundled CLI
// App Server under a disposable HOME with a loopback fixed-response inferencer and the
// official config contract (features.mcp + mcp.servers stdio) registering this repo's
// synthetic read-only MCP server (scripts/lhi-zcode-mcp-contract.mjs --stdio).
//
// Evidence ladder, per #80 acceptance:
//   advertised tools   -> tool names observed in the inferencer request body (not self-reported)
//   issued tool-call   -> native session events during the turn + the follow-up inferencer
//                         request containing the tool result / tool error message
//   execution count    -> the MCP server's own JSONL invocation log (independent positive control)
//   negatives          -> unknown tool, wrong-typed parameter, caller-side timeout, MCP disabled
// Bounded waits only; disposable HOME is removed in finally; no user config is touched.
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { rpcProcess } from './rpc-probe.mjs';
import { redactProbeText, startupLogSummary } from './probe-diagnostics.mjs';

const execFileAsync = promisify(execFile);
const entry = process.env.LAM_ZCODE_ENTRY ?? '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';
const contractScript = resolve(dirname(fileURLToPath(import.meta.url)), 'lhi-zcode-mcp-contract.mjs');
// Per-run unique marker injected into the MCP child's argv: process discovery for cleanup
// must match this exact run id, never the shared script name (other concurrent experiments
// run the same script and must never be killed by this probe).
const runId = randomUUID();
const mcpChildMarker = `lhi-zcode-mcp-contract.mjs --stdio --run-id ${runId}`;

if (process.argv.includes('--self-test')) {
  // Gate self-test: proves each assertion actually catches a synthetic violation, without
  // involving ZCode at all. A gate that cannot fail is a gate that proves nothing.
  const summary = gateSelfTest();
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.verdict === 'PASS' ? 0 : 1);
}

const root = await mkdtemp(join(tmpdir(), 'lam-lhi-zcode-outbound-'));
const mcpLog = join(root, 'mcp-invocations.jsonl');
// Children (app-server, its MCP child) get an explicit allowlist only: inheriting the full
// operator environment could leak real provider credentials into disposable processes.
const allowEnvKeys = ['PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM', 'SHELL', 'USER', 'LOGNAME', 'SYSTEMROOT'];
const baseEnv = Object.fromEntries(allowEnvKeys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
const env = {
  ...baseEnv, HOME: root,
  ...(process.platform === 'win32' ? { USERPROFILE: root, APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'localappdata') } : {}),
  XDG_CONFIG_HOME: root, XDG_DATA_HOME: root, ZCODE_DATA_BASE_DIR: root,
  ZCODE_STORAGE_DIR: join(root, 'storage'), ZCODE_SESSION_DB_PATH: join(root, 'sessions.sqlite'),
  ZCODE_LOG_DIR: join(root, 'logs'),
  LHI_MCP_LOG: mcpLog,
};
const report = {
  harness: 'zcode', probe: 'lhi-zcode-mcp-outbound-smoke',
  platform: process.platform, node: process.version,
  inference: 'localhost deterministic fixture; no external model', externalModelRequests: 0, fixtureRequests: 0,
  results: {}, negatives: {},
};
report.startup = { storageStates: [], preferenceRequests: [], preferenceReplies: 0 };
let rpc; let phase = 'echo'; let emitted = false; let phaseRequests = 0;
let advertisedTools = []; let echoToolName; let hangToolName;
function setPhase(next) { phase = next; emitted = false; phaseRequests = 0; }
const observed = []; const listeners = new Set();
function observe(message) { observed.push(message); for (const listener of listeners) listener(message); }
function waitFor(predicate, budgetMs = 45000, label = 'native event') {
  const previous = observed.find(predicate); if (previous) return Promise.resolve(previous);
  return new Promise((resolve, reject) => {
    const listener = message => { if (predicate(message)) { clearTimeout(timer); listeners.delete(listener); resolve(message); } };
    const timer = setTimeout(() => { listeners.delete(listener); reject(new Error(`${label} timed out after ${budgetMs}ms`)); }, budgetMs);
    listeners.add(listener);
  });
}
const toolCallDelta = (name, argumentsObject) => ({
  tool_calls: [{ index: 0, id: `call_lhi_${name.replaceAll(/[^a-z0-9]/gi, '')}`, type: 'function', function: { name, arguments: JSON.stringify(argumentsObject) } }],
});
const fixture = createServer(async (request, response) => {
  if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) { response.writeHead(404).end(); return; }
  let raw = ''; for await (const chunk of request) raw += chunk;
  let body; try { body = JSON.parse(raw); } catch { response.writeHead(400).end(); return; }
  report.fixtureRequests++;
  phaseRequests++;
  advertisedTools = (body.tools ?? []).map(tool => tool.function?.name).filter(Boolean);
  const messagesText = JSON.stringify(body.messages ?? []);
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const delta = (value, finish = null) => response.write(`data: ${JSON.stringify({ id: 'chatcmpl-lhi-fixture', object: 'chat.completion.chunk', created: 0, model: 'lam-fixture', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`);
  const finishText = (text) => { delta({ content: text }); delta({}, 'stop'); response.end('data: [DONE]\n\n'); };
  delta({ role: 'assistant' });
  // Hard guard: a misbehaving loop must never spin unbounded; after 10 requests in one
  // phase stop emitting tool_calls, record the anomaly and end the turn with text.
  if (phaseRequests > 10) {
    report.anomalies ??= [];
    report.anomalies.push({ phase, phaseRequests, note: 'phase request cap exceeded; forcing final text' });
    finishText('LHI fixture phase cap reached'); return;
  }
  if (phase === 'echo') {
    if (!emitted) {
      emitted = true;
      echoToolName = advertisedTools.find(name => name.includes('probe_echo'));
      hangToolName = advertisedTools.find(name => name.includes('probe_hang'));
      report.results.advertisedNames = { echoToolName: echoToolName ?? null, hangToolName: hangToolName ?? null, advertisedCount: advertisedTools.length, advertisedSample: advertisedTools.slice(0, 40) };
      if (echoToolName) { delta(toolCallDelta(echoToolName, { phrase: 'lhi-positive' })); delta({}, 'tool_calls'); response.end('data: [DONE]\n\n'); return; }
      // Advertised list without the fixture tool is itself the finding; fall through to text.
    } else {
      report.results.resultCorrelation = { observedInFollowupRequest: messagesText.includes('lhi-echo:lhi-positive'), followupMentionsToolResult: /lhi-echo/i.test(messagesText) };
    }
    finishText('LHI OUTBOUND ECHO VERIFIED'); return;
  }
  if (phase === 'unknown') {
    if (!emitted) {
      emitted = true;
      const prefix = (echoToolName ?? 'mcp__lam-lhi__probe_echo').replaceAll('probe_echo', '');
      delta(toolCallDelta(`${prefix}nonexistent_tool`, {})); delta({}, 'tool_calls'); response.end('data: [DONE]\n\n'); return;
    }
    report.negatives.unknownTool = { followupMentionsError: /error|not found|unknown|invalid|no such/i.test(messagesText) };
    finishText('unknown tool case done'); return;
  }
  if (phase === 'wrongtype') {
    if (!emitted) {
      emitted = true;
      delta(toolCallDelta(echoToolName ?? 'probe_echo', { phrase: 12345 })); delta({}, 'tool_calls'); response.end('data: [DONE]\n\n'); return;
    }
    report.negatives.wrongTypeParam = { followupMentionsValidationError: /expected string|invalid input|validation/i.test(messagesText) };
    finishText('wrong type case done'); return;
  }
  if (phase === 'permission') {
    // Build-mode MCP tool call: does the harness gate read-only MCP tools behind a native
    // permission request? Either outcome is evidence; the runner records which occurred.
    if (!emitted) {
      emitted = true;
      delta(toolCallDelta(echoToolName ?? 'probe_echo', { phrase: 'lhi-perm' })); delta({}, 'tool_calls'); response.end('data: [DONE]\n\n'); return;
    }
    report.results.permissionProbe ??= {};
    report.results.permissionProbe.followupMentionsDeniedOrError = /denied|deny|error|not authorized|permission/i.test(messagesText);
    finishText('permission case done'); return;
  }
  if (phase === 'hang') {
    if (!emitted) {
      emitted = true;
      delta(toolCallDelta(hangToolName ?? 'probe_hang', {})); delta({}, 'tool_calls'); response.end('data: [DONE]\n\n'); return;
    }
    report.negatives.timeout = { followupMentionsTimeoutOrError: /timed? ?out|timeout|error|cancel/i.test(messagesText) };
    finishText('hang case done'); return;
  }
  if (phase === 'disabled') {
    if (!emitted) {
      emitted = true;
      report.negatives.disabledMcp = { advertisedContainsEcho: advertisedTools.includes(echoToolName ?? 'probe_echo'), advertisedCount: advertisedTools.length };
      if (echoToolName) { delta(toolCallDelta(echoToolName, { phrase: 'should-not-execute' })); delta({}, 'tool_calls'); response.end('data: [DONE]\n\n'); return; }
    } else {
      report.negatives.disabledMcp.followupMentionsError = /error|not found|unknown|invalid|no such|unavailable/i.test(messagesText);
    }
    finishText('disabled case done'); return;
  }
  finishText('LHI fixture fallback');
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
function summarizeTurnEvents(inputId) {
  return {
    eventTypes: [...new Set(observed.filter(m => m.method === 'session/event' && m.params?.payload?.inputId === inputId).map(m => m.params.type))],
    toolMentions: observed
      .filter(m => m.method === 'session/event' && m.params?.payload?.inputId === inputId && /probe_echo|probe_hang|nonexistent_tool|mcp__/.test(JSON.stringify(m)))
      .map(m => ({ type: m.params.type, snippet: JSON.stringify(m.params.payload).slice(0, 220) })),
  };
}
async function runTurn(rpc_, sessionId, label) {
  const inputId = randomUUID();
  const accepted = await rpc_.call('session/send', { sessionId, inputId, modelSelection: selection, content: `LHI fixture turn: ${label}.` });
  const completed = await waitFor(
    message => message.method === 'session/event' && ['turn.completed', 'turn.failed'].includes(message.params?.type) && message.params.payload?.inputId === inputId,
    45000, `${label} turn outcome`,
  );
  return { accepted: accepted.accepted, eventType: completed.params.type, resultType: completed.params.payload.resultType, error: completed.params.payload.error?.message, ...summarizeTurnEvents(inputId) };
}
const selection = { providerId: 'lam-fixture', modelId: 'lam-fixture', options: { reasoningLevel: 'disabled' } };
try {
  report.entry = {
    path: entry,
    sha256: createHash('sha256').update(await readFile(entry)).digest('hex'),
  };
  report.entry.cliVersion = (await execFileAsync(process.execPath, [entry, '--version'], { env, cwd: root, timeout: 15000 })).stdout.trim();
  await copyFile(process.env.LAM_ZCODE_BUILTIN_CONFIG ?? resolve(dirname(entry), '../config/provider/zcode-builtin.json'), join(root, 'builtin.json'));
  env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = join(root, 'builtin.json');
  env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = join(root, 'personal.json');
  await writeFile(env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, JSON.stringify({ schemaVersion: 1, config: {
    providerConfigRules: { providerRules: [{ providerId: 'lam-fixture', providerName: 'LAM Local Fixture', config: {
      group: 'standard-personal', access: { type: 'api-key', apiKey: 'lam-local-fixture-not-a-real-key' },
      api: { type: 'openai-chat-completions', baseUrl: `http://127.0.0.1:${fixture.address().port}/v1` }, personalModelIds: ['lam-fixture'],
    } }] }, modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] }, defaultModelSelection: selection,
  } }), { mode: 0o600 });
  const mcpConfig = {
    features: { mcp: true, subagent: false, memory: false, skill: false },
    plugins: { enabled: false }, hooks: { enabled: false },
    mcp: { servers: { 'lam-lhi': {
      type: 'stdio', command: process.execPath, args: [contractScript, '--stdio', '--run-id', runId], enabled: true, timeoutMs: 5000,
    } } },
  };
  await mkdir(join(root, '.zcode', 'cli'), { recursive: true });
  await writeFile(join(root, '.zcode', 'cli', 'config.json'), JSON.stringify(mcpConfig));
  const connect = () => {
    const connection = rpcProcess(process.execPath, [entry, 'app-server', '--cwd', root], env, root, { jsonrpc: false, captureDiagnostics: true, onMessage: message => {
      observe(message);
      if (message.method === 'startup/storageState') report.startup.storageStates.push({ phase: message.params?.phase, elapsedMs: message.params?.elapsedMs, errorCode: message.params?.errorCode });
      if (message.method === 'interaction/requestPermission' && 'id' in message) {
        connection.reply(message.id, { decision: 'deny', reason: 'LHI fixture rejects this temporary operation.' });
        report.results.permissionProbe ??= {};
        report.results.permissionProbe.nativeRequestObserved = true;
        report.results.permissionProbe.nativeDecision = 'deny';
      }
      if (message.method === 'session/requestRuntimePreferences' && 'id' in message) {
        report.startup.preferenceRequests.push({ scope: message.params?.scope });
        connection.reply(message.id, { nativeSearchEnhancementsEnabled: false, toolSearchMode: 'off', subagentRuntimeConfigEnabled: false, memoryEnabled: false, askUserQuestionAutoResolutionEnabled: false, modelContextBudgetStrategy: 'preflight-v1' });
        report.startup.preferenceReplies++;
      }
    } });
    return connection;
  };
  rpc = connect();
  await rpc.call('runtime/capabilities', {});
  report.results.runtimeCapabilities = { status: 'verified' };
  const sessionId = `sess_${randomUUID()}`;
  const workspace = { workspacePath: root, workspaceKey: root };
  await rpc.call('session/create', { sessionId, workspace, model: selection, persistence: 'immediate', mode: 'plan', titleGenerationEnabled: false }, { timeoutMs: 60000 });
  report.results.create = { status: 'verified' };
  await rpc.call('session/subscribe', { sessionId, deliveryKind: 'desktop-continuous' });

  setPhase('echo');
  report.results.advertisedFirstTurn = await runTurn(rpc, sessionId, 'echo');
  if (!echoToolName) {
    report.results.toolCall = { status: 'unknown', reason: 'MCP tool not advertised in inferencer request', advertisedToolsSample: advertisedTools.slice(0, 40) };
  } else {
    report.results.toolCall = {
      advertisedName: echoToolName, hangAdvertisedName: hangToolName ?? null,
      issued: report.results.advertisedFirstTurn.eventType === 'turn.completed',
    };
    setPhase('unknown');
    report.negatives.unknownToolTurn = await runTurn(rpc, sessionId, 'unknown');
    setPhase('wrongtype');
    report.negatives.wrongTypeTurn = await runTurn(rpc, sessionId, 'wrongtype');
    // Permission negative: same read-only tool, build mode. If the harness requests native
    // permission we deny it; if it does not, that absence is itself recorded evidence.
    await rpc.call('session/setMode', { sessionId, mode: 'build' });
    setPhase('permission');
    report.results.permissionProbe ??= { nativeRequestObserved: false };
    report.results.permissionTurn = await runTurn(rpc, sessionId, 'permission');
    await rpc.call('session/setMode', { sessionId, mode: 'plan' });
    setPhase('hang');
    const hangStarted = Date.now();
    report.negatives.timeoutTurn = await runTurn(rpc, sessionId, 'hang');
    report.negatives.timeoutDurationMs = Date.now() - hangStarted;
  }
  await rpc.call('session/close', { sessionId });
  // Control: same binary, MCP disabled at config level in a fresh app-server process.
  await rpc.close();
  report.cleanup ??= {};
  report.cleanup.appServerExitFirst = rpc.diagnostics().exit;
  await writeFile(join(root, '.zcode', 'cli', 'config.json'), JSON.stringify({
    features: { mcp: false, subagent: false, memory: false, skill: false },
    plugins: { enabled: false }, hooks: { enabled: false },
  }));
  rpc = connect();
  await rpc.call('runtime/capabilities', {});
  const disabledSessionId = `sess_${randomUUID()}`;
  await rpc.call('session/create', { sessionId: disabledSessionId, workspace, model: selection, persistence: 'immediate', mode: 'plan', titleGenerationEnabled: false }, { timeoutMs: 60000 });
  await rpc.call('session/subscribe', { sessionId: disabledSessionId, deliveryKind: 'desktop-continuous' });
  phase = 'disabled';
  emitted = false;
  report.negatives.disabledMcpTurn = await runTurn(rpc, disabledSessionId, 'disabled');
  await rpc.call('session/close', { sessionId: disabledSessionId });
  report.stage = 'complete';
} catch (e) {
  report.error = redactProbeText(e.message, root);
  report.observedMethods = [...new Set(observed.map(message => message.method).filter(Boolean))];
  report.observedEventTypes = [...new Set(observed.filter(message => message.method === 'session/event').map(message => message.params?.type))];
  process.exitCode = 1;
} finally {
  await rpc?.close();
  report.cleanup ??= {};
  report.cleanup.appServerExitSecond = rpc ? rpc.diagnostics().exit : null;
  report.diagnostics = rpc ? JSON.parse(redactProbeText(JSON.stringify(rpc.diagnostics()), root)) : undefined;
  report.startup.logs = await startupLogSummary(join(root, 'logs'), root).catch(() => []);
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  report.cleanup.fixtureRequests = report.fixtureRequests;
  report.cleanup.externalModelRequests = report.externalModelRequests;
  try { report.mcpServerLog = (await readFile(mcpLog, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch { report.mcpServerLog = null; }
  // Orphan cleanup targets ONLY processes belonging to this run: the MCP child's argv carries
  // the per-run marker; the app-server ran with --cwd under the per-run disposable home.
  // Scan outcomes are distinguished: pgrep exit 1 is a definitive no-match; any other scan
  // failure (missing binary, timeout) is 'check-failed' and NEVER counts as clean. Anything
  // matching the shared script name alone is recorded, never killed.
  if (process.platform !== 'win32') {
    await new Promise(resolve => setTimeout(resolve, 300));
    const ownedMarkers = [mcpChildMarker, root];
    const findings = [];
    const scanErrors = [];
    for (const marker of ownedMarkers) {
      let stdout = '';
      try { ({ stdout } = await execFileAsync('pgrep', ['-f', marker], { timeout: 5000 })); }
      catch (error) {
        if (error.code === 1) continue; // pgrep: definitively no match for this marker
        scanErrors.push(String(error.message ?? error).slice(0, 120));
        continue;
      }
      for (const line of stdout.trim().split('\n').filter(Boolean)) {
        const pid = Number(line);
        if (!Number.isInteger(pid) || pid === process.pid) continue;
        let command = '';
        let psVerified = true;
        try { ({ stdout: command } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command='], { timeout: 5000 })); }
        catch { psVerified = false; }
        const owned = psVerified && ownedMarkers.some(m => command.includes(m));
        const entry = { pid, command: psVerified ? redactProbeText(command.trim(), root).slice(0, 200) : null, owned, psVerified };
        if (owned) { try { process.kill(pid, 'SIGKILL'); entry.killed = true; } catch { entry.killed = false; } }
        findings.push(entry);
      }
    }
    report.cleanup.orphans = scanErrors.length
      ? { status: 'check-failed', scanErrors, findings }
      : findings.length === 0
        ? { status: 'clean' }
        : findings.every(entry => entry.owned && entry.killed)
          ? { status: 'owned-orphans-killed', findings }
          : { status: 'unresolved-findings', findings };
  } else report.cleanup.orphans = { status: 'unsupported-on-windows' };
  await rm(root, { recursive: true, force: true });
  // Removal proof: pass only on a definitive ENOENT from stat; any other outcome (exists,
  // permission error, EISDIR ambiguity) fails the gate.
  try {
    const stats = await stat(root);
    report.cleanup.disposableHomeRemoved = false;
    report.cleanup.disposableHomeRemovalError = `still present (isDirectory=${stats.isDirectory()})`;
  } catch (error) {
    report.cleanup.disposableHomeRemoved = error.code === 'ENOENT';
    if (error.code !== 'ENOENT') report.cleanup.disposableHomeRemovalError = error.code;
  }
  const evaluation = evaluateAssertions(report, { echoToolName, runId });
  report.assertions = evaluation.gates;
  report.verdict = evaluation.verdict;
  if (report.verdict === 'FAIL') process.exitCode = 1;
}
console.log(JSON.stringify(report, null, 2));

/** Pure assertion gate over the final report; no I/O, no ZCode dependency. */
function evaluateAssertions(reportData, context) {
  const log = reportData.mcpServerLog ?? [];
  const invocationEntries = log.filter(entry => entry.phase === 'invoked');
  const phraseCount = phrase => invocationEntries.filter(entry => entry.args?.phrase === phrase).length;
  const toolCount = tool => invocationEntries.filter(entry => entry.tool === tool).length;
  const permission = reportData.results?.permissionProbe ?? {};
  const permExecutions = phraseCount('lhi-perm');
  // Two-sided, full-chain permission check. If a native request was observed, the denial
  // chain must be complete: our deny decision, a denied/error receipt back to the model,
  // and zero executions. If no request was observed, the tool must have executed exactly
  // once (the deterministic tool_call cannot vanish). Anything else fails.
  const permissionBranchConsistent =
    permission.nativeRequestObserved === true
      ? permission.nativeDecision === 'deny' && permission.followupMentionsDeniedOrError === true && permExecutions === 0
      : permission.nativeRequestObserved === false
        ? permExecutions === 1
        : false;
  const allowedPhrases = new Set(['lhi-positive', 'lhi-perm']);
  const unexpectedExecutions = invocationEntries.filter(entry =>
    (entry.tool === 'probe_echo' && !allowedPhrases.has(entry.args?.phrase)) ||
    (entry.tool === 'probe_hang' && Object.keys(entry.args ?? {}).length !== 0) ||
    !['probe_echo', 'probe_hang'].includes(entry.tool));
  const startupEntries = log.filter(entry => entry.phase === 'startup');
  const logBelongsToRun = startupEntries.length >= 1 && startupEntries.every(entry => entry.runId === context.runId);
  const executionsBookkeeping = invocationEntries.length === 2 + permExecutions
    && phraseCount('lhi-positive') === 1 && toolCount('probe_hang') === 1;
  const cleanExit = value => value?.code === 0 && value?.signal === null;
  const gates = [];
  const gate = (name, pass, detail) => gates.push({ name, pass: pass === true, detail });
  gate('advertised-echo-name', typeof context.echoToolName === 'string' && context.echoToolName.startsWith('mcp__lam-lhi__'), context.echoToolName ?? null);
  gate('positive-turn-completed', reportData.results?.advertisedFirstTurn?.eventType === 'turn.completed' && reportData.results?.advertisedFirstTurn?.resultType === 'success');
  gate('result-correlation', reportData.results?.resultCorrelation?.observedInFollowupRequest === true);
  gate('echo-executed-exactly-once', phraseCount('lhi-positive') === 1, `count=${phraseCount('lhi-positive')}`);
  gate('hang-invoked-exactly-once', toolCount('probe_hang') === 1, `count=${toolCount('probe_hang')}`);
  gate('disabled-no-execution', phraseCount('should-not-execute') === 0, `count=${phraseCount('should-not-execute')}`);
  gate('unknown-tool-fail-closed', reportData.negatives?.unknownTool?.followupMentionsError === true && reportData.negatives?.unknownToolTurn?.eventType === 'turn.completed');
  gate('wrong-type-fail-closed', reportData.negatives?.wrongTypeParam?.followupMentionsValidationError === true && reportData.negatives?.wrongTypeTurn?.eventType === 'turn.completed');
  gate('timeout-fail-closed', reportData.negatives?.timeout?.followupMentionsTimeoutOrError === true && reportData.negatives?.timeoutDurationMs > 3000 && reportData.negatives?.timeoutDurationMs < 20000, `${reportData.negatives?.timeoutDurationMs}ms`);
  gate('disabled-control', reportData.negatives?.disabledMcp?.advertisedContainsEcho === false && reportData.negatives?.disabledMcp?.followupMentionsError === true);
  gate('permission-branch-consistent', permissionBranchConsistent, JSON.stringify({ nativeRequestObserved: permission.nativeRequestObserved ?? null, nativeDecision: permission.nativeDecision ?? null, followupMentionsDeniedOrError: permission.followupMentionsDeniedOrError ?? null, lhiPermExecutions: permExecutions }));
  gate('no-unexpected-executions', unexpectedExecutions.length === 0 && executionsBookkeeping && logBelongsToRun, JSON.stringify({ unexpected: unexpectedExecutions.length, total: invocationEntries.length, expected: 2 + permExecutions, logBelongsToRun }));
  gate('no-external-model-requests-accounted', reportData.externalModelRequests === 0, 'accounting invariant: the loopback fixture is the only configured inference endpoint (provider baseUrl); this is bookkeeping, not independent network-egress detection');
  gate('app-server-clean-exits', cleanExit(reportData.cleanup?.appServerExitFirst) && cleanExit(reportData.cleanup?.appServerExitSecond), JSON.stringify({ first: reportData.cleanup?.appServerExitFirst ?? null, second: reportData.cleanup?.appServerExitSecond ?? null }));
  gate('no-orphan-processes', ['clean', 'unsupported-on-windows'].includes(reportData.cleanup?.orphans?.status), reportData.cleanup?.orphans?.status ?? null);
  gate('disposable-home-removed', reportData.cleanup?.disposableHomeRemoved === true && !reportData.cleanup?.disposableHomeRemovalError, reportData.cleanup?.disposableHomeRemovalError ?? null);
  return { gates, verdict: gates.every(entry => entry.pass) ? 'PASS' : 'FAIL' };
}

/** Synthetic false-positive tests for every gate; runs without ZCode. */
function gateSelfTest() {
  const echoName = 'mcp__lam-lhi__probe_echo';
  const runId = 'self-test-run';
  const happyReport = () => ({
    externalModelRequests: 0,
    results: {
      advertisedFirstTurn: { eventType: 'turn.completed', resultType: 'success' },
      resultCorrelation: { observedInFollowupRequest: true },
      permissionProbe: { nativeRequestObserved: true, nativeDecision: 'deny', followupMentionsDeniedOrError: true },
    },
    negatives: {
      unknownTool: { followupMentionsError: true }, unknownToolTurn: { eventType: 'turn.completed' },
      wrongTypeParam: { followupMentionsValidationError: true }, wrongTypeTurn: { eventType: 'turn.completed' },
      timeout: { followupMentionsTimeoutOrError: true }, timeoutDurationMs: 5100,
      disabledMcp: { advertisedContainsEcho: false, followupMentionsError: true },
    },
    mcpServerLog: [
      { phase: 'startup', pid: 1, runId },
      { tool: 'probe_echo', phase: 'invoked', args: { phrase: 'lhi-positive' } },
      { tool: 'probe_hang', phase: 'invoked', args: {} },
    ],
    cleanup: {
      appServerExitFirst: { code: 0, signal: null }, appServerExitSecond: { code: 0, signal: null },
      orphans: { status: 'clean' }, disposableHomeRemoved: true,
    },
  });
  const happyContext = { echoToolName: echoName, runId };
  const violations = [
    ['advertised-echo-name', (r, c) => { c.echoToolName = 'builtin_tool'; }],
    ['positive-turn-completed', (r) => { delete r.results.advertisedFirstTurn.eventType; }],
    ['positive-turn-completed', (r) => { r.results.advertisedFirstTurn.resultType = 'failure'; }],
    ['result-correlation', (r) => { r.results.resultCorrelation.observedInFollowupRequest = false; }],
    ['echo-executed-exactly-once', (r) => { r.mcpServerLog.push({ tool: 'probe_echo', phase: 'invoked', args: { phrase: 'lhi-positive' } }); }],
    ['hang-invoked-exactly-once', (r) => { r.mcpServerLog = r.mcpServerLog.filter(e => e.tool !== 'probe_hang'); }],
    ['disabled-no-execution', (r) => { r.mcpServerLog.push({ tool: 'probe_echo', phase: 'invoked', args: { phrase: 'should-not-execute' } }); }],
    ['unknown-tool-fail-closed', (r) => { r.negatives.unknownTool.followupMentionsError = false; }],
    ['wrong-type-fail-closed', (r) => { r.negatives.wrongTypeTurn.eventType = 'turn.failed'; }],
    ['timeout-fail-closed', (r) => { r.negatives.timeoutDurationMs = 100; }],
    ['disabled-control', (r) => { r.negatives.disabledMcp.advertisedContainsEcho = true; }],
    ['permission-branch-consistent', (r) => { r.mcpServerLog.push({ tool: 'probe_echo', phase: 'invoked', args: { phrase: 'lhi-perm' } }); }],
    ['permission-branch-consistent', (r) => { r.results.permissionProbe.nativeDecision = undefined; }],
    ['permission-branch-consistent', (r) => { r.results.permissionProbe.followupMentionsDeniedOrError = false; }],
    ['permission-branch-consistent', (r) => { delete r.results.permissionProbe; }],
    ['no-unexpected-executions', (r) => { r.mcpServerLog.push({ tool: 'rogue_tool', phase: 'invoked', args: {} }); }],
    ['no-unexpected-executions', (r) => { r.mcpServerLog.push({ tool: 'probe_echo', phase: 'invoked', args: { phrase: 'stray-phrase' } }); }],
    ['no-unexpected-executions', (r) => { r.mcpServerLog[0].runId = 'a-different-run'; }],
    ['no-external-model-requests-accounted', (r) => { r.externalModelRequests = 1; }],
    ['app-server-clean-exits', (r) => { r.cleanup.appServerExitSecond = { code: null, signal: 'SIGKILL' }; }],
    ['no-orphan-processes', (r) => { r.cleanup.orphans = { status: 'check-failed', scanErrors: ['pgrep: command not found'], findings: [] }; }],
    ['no-orphan-processes', (r) => { r.cleanup.orphans = { status: 'unresolved-findings', findings: [{ pid: 1, owned: false }] }; }],
    ['disposable-home-removed', (r) => { r.cleanup.disposableHomeRemoved = false; r.cleanup.disposableHomeRemovalError = 'EISDIR'; }],
  ];
  const happy = evaluateAssertions(happyReport(), happyContext);
  const caught = [];
  for (const [expectedGate, mutate] of violations) {
    const reportData = happyReport(); const context = { ...happyContext };
    mutate(reportData, context);
    const outcome = evaluateAssertions(reportData, context);
    caught.push({ expectedGate, verdict: outcome.verdict, gateFailed: outcome.gates.some(g => g.name === expectedGate && !g.pass) });
  }
  const uncaught = caught.filter(entry => entry.verdict !== 'FAIL' || !entry.gateFailed);
  return {
    happyPathVerdict: happy.verdict, gateCount: happy.gates.length,
    violationCount: caught.length, uncaught,
    verdict: happy.verdict === 'PASS' && uncaught.length === 0 ? 'PASS' : 'FAIL',
  };
}
