// LHI-1 (#80, third review): run the two ZCode-free probe self-tests as part of CI so the
// verification tooling itself is continuously checked. Neither test launches ZCode, any
// harness binary, or a network endpoint; they validate (1) the synthetic MCP server against
// the official SDK client and (2) that every assertion-gate violation flips the verdict.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptsDir = join(fileURLToPath(new URL('../../../scripts/', import.meta.url)));

async function runSelfTest(script: string, args: string[] = []) {
  const { stdout } = await execFileAsync(process.execPath, [join(scriptsDir, script), ...args], {
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout) as Record<string, unknown>;
}

it('the synthetic MCP fixture server passes its standalone SDK-client self-test', async () => {
  const result = await runSelfTest('lhi-zcode-mcp-contract.mjs', ['--self-test']);
  expect(result.selfTest).toBe('PASS');
  expect(result.toolsListed).toContain('probe_echo');
  expect(result.toolsListed).toContain('probe_hang');
  expect(result.echoRoundTrip).toBe(true);
  expect(result.wrongTypeParamRejected).toBe(true);
  expect(result.hangNeverReturns).toBe(true);
});

it('every assertion-gate violation flips the probe verdict to FAIL (false-positive guard)', async () => {
  const result = await runSelfTest('lhi-zcode-mcp-outbound-smoke.mjs', ['--self-test']);
  expect(result.happyPathVerdict).toBe('PASS');
  expect(typeof result.gateCount).toBe('number');
  expect(result.gateCount).toBeGreaterThan(0);
  expect(typeof result.violationCount).toBe('number');
  expect(result.violationCount).toBeGreaterThanOrEqual(19);
  expect(result.uncaught, `uncaught violations: ${JSON.stringify(result.uncaught)}`).toEqual([]);
  expect(result.verdict).toBe('PASS');
});
