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
      'LAM 链路观察台（只读，OBS-0 V0）\n' +
        '用法：node dist/index.js --data <网关私有目录> [--port <0-65535>]\n' +
        '网关必须已运行且 --data 下存在 control.json。观察台仅绑定 127.0.0.1，\n' +
        '绝不调用 pair/confirm/spawn/send/cancel/retry/shutdown 等变更类命令。',
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
          note: '在本地浏览器中打开 loginUrl，一次性令牌仅可使用一次。',
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
