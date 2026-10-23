import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Read application-shipped metadata/code only. Never bootstrap the renderer SDK.
const app = process.env.LAM_WORKBUDDY_APP ?? '/Applications/WorkBuddy.app';
const report = { harness: 'workbuddy', platform: process.platform, launchedApp: false, accessedUserSessions: false, results: {} };
try {
  if (process.platform !== 'darwin') throw new Error('This inventory probe reads macOS application bundles only');
  const plist = join(app, 'Contents', 'Info.plist');
  const value = key => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], { encoding: 'utf8' }).trim();
  report.version = value('CFBundleShortVersionString'); report.bundleId = value('CFBundleIdentifier');
  const source = readFileSync(join(app, 'Contents', 'Resources', 'wb-guest-sdk', 'wb.js'), 'utf8');
  report.results.shippedGuestSdk = {
    sha256: createHash('sha256').update(source).digest('hex'), bytes: Buffer.byteLength(source),
    browserWindowGuardObserved: source.includes('window is undefined'),
    rendererInvokeBridgeObserved: source.includes('window.__wbInvoke'),
    hostPortBootstrapObserved: source.includes('__wb_port_init__'),
    interpretation: 'Renderer-host transport bootstrap is present; this is not evidence of a standalone supported harness-control API.',
  };
  for (const capability of ['create', 'resume', 'send', 'stream', 'cancel', 'permissions', 'attachExistingGui'])
    report.results[capability] = { status: 'unknown', reason: 'No supported direct LAN/stdio control contract established by this metadata-only inspection' };
  report.documentedCandidates = [
    { url: 'https://open.workbuddy.cn/docs/connector', scope: 'Outbound MCP/CLI extensions' },
    { url: 'https://open.workbuddy.cn/docs/openapi', scope: 'Hosted OAuth local-assistant and cloud-task API; requires separate developer application authorization' },
  ];
} catch (e) { report.error = e.message; process.exitCode = 1; }
console.log(JSON.stringify(report, null, 2));
