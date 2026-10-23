import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** Bounded JSON-lines probe. Startup diagnostics are opt-in and redacted by callers. */
export function rpcProcess(command, args, env, cwd, options = {}) {
  const child = spawn(command, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let nextId = 1;
  let terminalError; let stderrTail = ''; let stdoutTextTail = ''; let exit;
  child.stderr.on('data', chunk => { if (options.captureDiagnostics) stderrTail = (stderrTail + chunk.toString()).slice(-8192); });
  function fail(error) { terminalError = error; for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); } pending.clear(); }
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.on('exit', (code, signal) => { exit = { code, signal }; fail(new Error(`process exited (${code})`)); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let response; try { response = JSON.parse(line); } catch { if (options.captureDiagnostics) stdoutTextTail = (stdoutTextTail + line + '\n').slice(-4096); return; }
    if (!response || typeof response !== 'object' || !('id' in response || 'method' in response)) {
      if (options.captureDiagnostics) stdoutTextTail = (stdoutTextTail + line + '\n').slice(-4096);
      return;
    }
    options.onMessage?.(response);
    if (response.method) return;
    const entry = pending.get(response.id);
    if (!entry) return;
    clearTimeout(entry.timer); pending.delete(response.id);
    if (response.error) entry.reject(new Error(`RPC ${response.error.code}: ${response.error.message}`));
    else entry.resolve(response.result);
  });
  return {
    call(method, params, callOptions = {}) {
      if (terminalError) return Promise.reject(terminalError);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, callOptions.timeoutMs ?? 15000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ ...(options.jsonrpc === false ? {} : { jsonrpc: '2.0' }), id, method, params }) + '\n');
      });
    },
    reply(id, result) { child.stdin.write(JSON.stringify({ ...(options.jsonrpc === false ? {} : { jsonrpc: '2.0' }), id, result }) + '\n'); },
    notify(method, params = {}) { child.stdin.write(JSON.stringify({ ...(options.jsonrpc === false ? {} : { jsonrpc: '2.0' }), method, params }) + '\n'); },
    diagnostics() { return { exit, stderrTail, stdoutTextTail }; },
    async close() {
      lines.close(); child.stdin.end();
      await new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode !== null || !child.pid) return resolve();
        const timer = setTimeout(() => { child.kill('SIGKILL'); }, 2000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    },
  };
}
