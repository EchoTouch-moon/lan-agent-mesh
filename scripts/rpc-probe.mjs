import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** Bounded JSON-lines probe; does not log credentials, stderr or native histories. */
export function rpcProcess(command, args, env, cwd, options = {}) {
  const child = spawn(command, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let nextId = 1;
  child.stderr.resume();
  function fail(error) { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); } pending.clear(); }
  child.on('error', fail);
  child.on('exit', code => fail(new Error(`process exited (${code})`)));
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let response; try { response = JSON.parse(line); } catch { return; }
    options.onMessage?.(response);
    if (response.method) return;
    const entry = pending.get(response.id);
    if (!entry) return;
    clearTimeout(entry.timer); pending.delete(response.id);
    if (response.error) entry.reject(new Error(`RPC ${response.error.code}: ${response.error.message}`));
    else entry.resolve(response.result);
  });
  return {
    call(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ ...(options.jsonrpc === false ? {} : { jsonrpc: '2.0' }), id, method, params }) + '\n');
      });
    },
    reply(id, result) { child.stdin.write(JSON.stringify({ ...(options.jsonrpc === false ? {} : { jsonrpc: '2.0' }), id, result }) + '\n'); },
    notify(method, params = {}) { child.stdin.write(JSON.stringify({ ...(options.jsonrpc === false ? {} : { jsonrpc: '2.0' }), method, params }) + '\n'); },
    async close() {
      lines.close(); child.stdin.end();
      await new Promise(resolve => {
        if (child.exitCode !== null) return resolve();
        const timer = setTimeout(() => { child.kill('SIGKILL'); }, 2000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    },
  };
}
