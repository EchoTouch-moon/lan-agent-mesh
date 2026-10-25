import { afterEach, expect, it } from 'vitest';
import { startAcceptanceFixture, FIXTURE_TEXT, permissionResult, writeCommand } from '../src/acceptance-fixture.js';
const fixtures: Awaited<ReturnType<typeof startAcceptanceFixture>>[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });
async function setup() { const fixture = await startAcceptanceFixture('fixture-owned-marker'); fixtures.push(fixture); return fixture; }
async function post(base: string, body: unknown) {
  return fetch(new URL('v1/messages', base), { method: 'POST', body: JSON.stringify(body) });
}
it('serves complete Messages SSE with required usage and fixed text, and refuses unknown/invalid requests', async () => {
  const fixture = await setup();
  const response = await post(fixture.baseUrl, { model: 'fixture-request-model', tools: [], messages: [] });
  const text = await response.text();
  const events = text.split('\n\n').filter(Boolean).map(frame => JSON.parse(frame.split('\n').find(line => line.startsWith('data: '))!.slice(6)) as Record<string, unknown>);
  expect(events[0]).toMatchObject({ type: 'message_start', message: { model: 'fixture-request-model', usage: { input_tokens: 1, output_tokens: 1 } } });
  expect(events.at(-1)?.type).toBe('message_stop'); expect(text).toContain(FIXTURE_TEXT);
  expect((await fetch(fixture.baseUrl)).status).toBe(404);
  expect((await post(fixture.baseUrl, [])).status).toBe(400);
  expect((await post(fixture.baseUrl, { text: 'x'.repeat(1024 * 1024 + 1) })).status).toBe(413);
  expect(fixture.snapshot()).toMatchObject({ calls: 1, rejected: 3 });
});
it('requires an observed sandbox denial before escalating the second fixed permission tool request', async () => {
  const fixture = await setup(); fixture.setMode('permission');
  const body = { tools: [{ name: 'pwsh' }], messages: [] as { role: string; content: unknown[] }[] };
  const first = await (await post(fixture.baseUrl, body)).text();
  expect(first).toContain('toolu_lam_1'); expect(first).not.toContain('sandbox_permissions');
  const noDenial = await (await post(fixture.baseUrl, body)).text();
  expect(noDenial).not.toContain('toolu_lam_2'); expect(fixture.snapshot().permissionStages).toBe(1);
  body.messages.push({ role: 'user', content: [{ type: 'tool_result', content: 'sandbox: file access denied' }] });
  const second = await (await post(fixture.baseUrl, body)).text();
  expect(second).toContain('toolu_lam_2'); expect(second).toContain('workspace-write');
  expect(fixture.snapshot()).toMatchObject({ permissionStages: 2, sandboxDenied: true, pwsh: true });
  for (const missing of ['control', 'rejectedOnce', 'sandboxDenied'] as const)
    expect(permissionResult({ control: true, rejectedOnce: true, sandboxDenied: true, markerExists: false, [missing]: false })).toBe(false);
  expect(permissionResult({ control: true, rejectedOnce: true, sandboxDenied: true, markerExists: true })).toBe(false);
  expect(permissionResult({ control: true, rejectedOnce: true, sandboxDenied: true, markerExists: false })).toBe(true);
  expect(writeCommand("C:\\fixture's folder\\marker")).toContain("fixture''s folder");
});
it('observes the held request and its actual abort before allowing the next fixture mode', async () => {
  const fixture = await setup(); fixture.setMode('hold'); const controller = new AbortController();
  const response = await fetch(new URL('v1/messages', fixture.baseUrl), { method: 'POST', body: '{}', signal: controller.signal });
  await fixture.waitHeld(0, AbortSignal.timeout(1000));
  expect(fixture.snapshot().holding).toBe(1); expect(() => fixture.setMode('text')).toThrow();
  const consume = response.text().catch(() => 'aborted'); controller.abort(); await consume;
  await fixture.drainHeld(AbortSignal.timeout(3000)); fixture.setMode('text'); expect(fixture.snapshot().holding).toBe(0);
});
