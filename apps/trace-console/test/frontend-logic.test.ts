// Synthetic negative tests for the in-page polling logic (P1 review follow-up).
// The real PAGE_JS bundle runs inside a Node vm with a mock DOM and a
// scriptable fetch, so the delay/reorder/reconnect/terminal-drain scenarios
// exercise the exact production control flow (addTask -> pollTask ->
// drainPage) without a browser or a Gateway.

import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { PAGE_JS } from '../src/page.js';

interface MockElement {
  id: string;
  textContent: string;
  className: string;
  hidden: boolean;
  value: string;
  children: MockElement[];
  handlers: Record<string, (event: { preventDefault(): void }) => void>;
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
  colSpan: number;
  appendChild(child: MockElement): void;
  addEventListener(type: string, fn: (event: { preventDefault(): void }) => void): void;
  querySelector(selector: string): MockElement;
}

function makeElement(id: string): MockElement {
  const element = {
    id,
    className: '',
    hidden: false,
    value: '',
    children: [],
    handlers: {},
    scrollHeight: 0,
    scrollTop: 0,
    clientHeight: 200,
    colSpan: 0,
    appendChild(child: MockElement) {
      element.children.push(child);
    },
    addEventListener(type: string, fn: (event: { preventDefault(): void }) => void) {
      element.handlers[type] = fn;
    },
    querySelector(selector: string) {
      const key = `__sub_${selector}`;
      const self = element as unknown as Record<string, unknown>;
      if (!self[key]) self[key] = makeElement(`${id}${selector}`);
      return self[key] as MockElement;
    },
  } as unknown as MockElement;
  let text = '';
  Object.defineProperty(element, 'textContent', {
    get: () => text,
    set: (value: string) => {
      text = String(value);
      // Mirror the DOM: assigning '' removes child nodes.
      if (text === '') (element as unknown as { children: MockElement[] }).children = [];
    },
    configurable: true,
  });
  return element;
}

type TaskPlanEntry = { hold?: Promise<void>; respond: () => unknown };

class FetchScript {
  readonly calls: string[] = [];
  private readonly taskPlan: TaskPlanEntry[] = [];
  overview: unknown = { ok: true, status: { nodeId: 'local' }, peers: [], sessions: [], diagnostics: {}, pending: [] };

  plan(entry: TaskPlanEntry): void {
    this.taskPlan.push(entry);
  }

  fetch = (url: string): Promise<{ status: number; json(): Promise<unknown> }> => {
    this.calls.push(url);
    if (url.startsWith('/api/overview'))
      return Promise.resolve({ status: 200, json: () => Promise.resolve(this.overview) });
    const entry = this.taskPlan.shift();
    if (!entry) return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: false, error: 'no-plan' }) });
    return Promise.resolve({
      status: 200,
      json: () => (entry.hold ? entry.hold.then(() => entry.respond()) : Promise.resolve(entry.respond())),
    });
  };

  taskCalls(): number {
    return this.calls.filter((url) => url.startsWith('/api/task')).length;
  }
}

interface Harness {
  elements: Map<string, MockElement>;
  script: FetchScript;
  tick(): void;
  addTask(taskId: string, peer: string): void;
  timeline(): string[];
  taskList(): string[];
  bannerText(): string;
}

async function boot(): Promise<Harness> {
  const elements = new Map<string, MockElement>();
  const script = new FetchScript();
  const intervals: (() => void)[] = [];
  const document = {
    cookie: 'lam_trace_csrf=cs',
    createElement: () => makeElement('created'),
    getElementById: (id: string) => {
      let element = elements.get(id);
      if (!element) {
        element = makeElement(id);
        elements.set(id, element);
      }
      return element;
    },
  };
  const sandbox = {
    document,
    fetch: script.fetch,
    setInterval: (fn: () => void) => {
      intervals.push(fn);
      return intervals.length;
    },
    clearInterval: () => {},
    URLSearchParams,
    location: { hash: '' },
    console: { log: () => {} },
  };
  vm.createContext(sandbox);
  // A real <select> defaults its value to the first option ("all types");
  // an empty value would filter out every event row.
  document.getElementById('filter-type').value = 'all';
  vm.runInContext(PAGE_JS, sandbox, { timeout: 5000 });
  const flush = async () => {
    for (let i = 0; i < 25; i++) await new Promise((resolve) => setImmediate(resolve));
  };
  await flush();
  const harness: Harness = {
    elements,
    script,
    tick: () => {
      for (const fn of [...intervals]) fn();
    },
    addTask: (taskId: string, peer: string) => {
      document.getElementById('task-id').value = taskId;
      document.getElementById('peer-id').value = peer;
      const submit = document.getElementById('add-task').handlers.submit;
      if (!submit) throw new Error('add-task submit handler missing');
      submit({ preventDefault: () => {} });
    },
    timeline: () => {
      const rows = elements.get('events')?.children ?? [];
      return rows.map((row) => row.children.map((cell) => `${cell.textContent}`).join('|'));
    },
    taskList: () => (elements.get('task-list')?.children ?? []).map((row) => row.children.map((cell) => `${cell.textContent}`).join('|')),
    bannerText: () => elements.get('banner')?.textContent ?? '',
  };
  await flush();
  return harness;
}

function page(state: string, events: unknown[], next: number, terminal: boolean): unknown {
  return { ok: true, state, events, next, terminal, observedAt: `T${next}` };
}

describe('frontend polling logic (synthetic negatives)', () => {
  it('serializes per-task polling: slow responses are not re-requested by the interval timer, and no event duplicates', async () => {
    const h = await boot();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    h.script.plan({ hold: held, respond: () => page('RUNNING', [{ seq: 0, type: 'started', taskId: 't1' }], 1, false) });
    h.script.plan({ respond: () => page('COMPLETED', [{ seq: 1, type: 'completed', taskId: 't1', preview: 'done' }], 2, true) });
    h.script.plan({ respond: () => page('COMPLETED', [], 2, true) });
    h.addTask('t1', 'p1');
    await new Promise((resolve) => setImmediate(resolve));
    // First request in flight (held). Two full poll ticks fire meanwhile.
    h.tick();
    h.tick();
    await new Promise((resolve) => setImmediate(resolve));
    h.tick();
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.script.taskCalls()).toBe(1); // inFlight guard skipped the timer polls
    release();
    for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
    expect(h.script.taskCalls()).toBe(3); // drain completed pages 2 and 3
    const rows = h.timeline();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('#0');
    expect(rows[1]).toContain('#1');
    expect(rows[1]).toContain('done');
    const seqs = rows.map((row) => row.split('|')[0]);
    expect(new Set(seqs).size).toBe(seqs.length); // no duplicate seq
    // Terminal + empty page: later ticks must not re-issue requests.
    h.tick();
    h.tick();
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.script.taskCalls()).toBe(3);
  });

  it('rejects cursor-regressing responses instead of duplicating or reordering events', async () => {
    const h = await boot();
    h.script.plan({ respond: () => page('RUNNING', [{ seq: 0, type: 'started', taskId: 't1' }], 1, false) });
    // Malicious/buggy response: replays seq 0 and regresses next below cursor.
    h.script.plan({ respond: () => page('RUNNING', [{ seq: 0, type: 'started', taskId: 't1' }], 0, false) });
    h.addTask('t1', 'p1');
    for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
    const rows = h.timeline();
    expect(rows).toHaveLength(1); // the regressing page was refused
    expect(h.taskList()[0]).toContain('响应游标非法');
    expect(h.taskList()[0]).toContain('不可观察');
  });

  it('clears the not-observable error marker after the Gateway becomes reachable again (reconnect)', async () => {
    const h = await boot();
    h.script.plan({ respond: () => ({ ok: false, error: 'unreachable', observedAt: 'T0' }) });
    h.script.plan({ respond: () => page('RUNNING', [{ seq: 0, type: 'started', taskId: 't1' }], 1, false) });
    h.script.plan({ respond: () => page('COMPLETED', [], 1, true) });
    h.addTask('t1', 'p1');
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
    expect(h.taskList()[0]).toContain('错误：unreachable');
    h.tick();
    for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
    const entry = h.taskList()[0];
    expect(entry).toContain('COMPLETED');
    expect(entry).not.toContain('错误：');
    expect(h.timeline()).toHaveLength(1);
  });

  it('keeps draining cursor pages after the terminal flag until an empty page, so replayed history is complete', async () => {
    const h = await boot();
    h.script.plan({ respond: () => page('COMPLETED', [{ seq: 0, type: 'started', taskId: 't1' }], 1, true) });
    h.script.plan({ respond: () => page('COMPLETED', [{ seq: 1, type: 'delta', taskId: 't1', preview: 'a' }], 2, true) });
    h.script.plan({ respond: () => page('COMPLETED', [{ seq: 2, type: 'completed', taskId: 't1', preview: 'ok' }], 3, true) });
    h.script.plan({ respond: () => page('COMPLETED', [], 3, true) });
    h.addTask('t1', 'p1');
    for (let i = 0; i < 15; i++) await new Promise((resolve) => setImmediate(resolve));
    expect(h.script.taskCalls()).toBe(4);
    expect(h.timeline()).toHaveLength(3);
    expect(h.timeline()[2]).toContain('ok');
  });

  it('enforces the 64 watched-task backpressure cap', async () => {
    const h = await boot();
    for (let i = 0; i < 64; i++) h.addTask(`task-${i}`, 'p1');
    await new Promise((resolve) => setImmediate(resolve));
    h.addTask('task-64', 'p1');
    await new Promise((resolve) => setImmediate(resolve));
    const rows = h.taskList();
    // 64 task rows plus one persistent cap notice rendered with the list.
    expect(rows).toHaveLength(65);
    expect(rows.some((row) => row.includes('task-63'))).toBe(true);
    expect(rows.some((row) => row.includes('task-64'))).toBe(false);
    expect(rows[64]).toContain('上限');
    expect(h.bannerText()).toContain('上限');
  });

  it('drops in-flight responses whose generation is stale after re-adding the task', async () => {
    const h = await boot();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    // First generation response is held; re-addTask bumps the generation.
    h.script.plan({ hold: held, respond: () => page('RUNNING', [{ seq: 0, type: 'started', taskId: 't1' }], 1, false) });
    h.script.plan({ respond: () => page('COMPLETED', [{ seq: 0, type: 'started', taskId: 't1' }], 1, false) });
    h.script.plan({ respond: () => page('COMPLETED', [], 1, true) });
    h.addTask('t1', 'p1');
    await new Promise((resolve) => setImmediate(resolve));
    h.addTask('t1', 'p1'); // generation++, terminal reset, fresh drain queued
    await new Promise((resolve) => setImmediate(resolve));
    release(); // stale first-generation response arrives now
    for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
    // The stale page must not double-append; the fresh drain wrote seq 0 once.
    expect(h.timeline()).toHaveLength(1);
    expect(h.timeline()[0]).toContain('#0');
  });

  it('rounds-robin task polling with a 16-per-tick budget', async () => {
    const h = await boot();
    for (let i = 0; i < 20; i++) h.addTask(`t${i}`, 'p1');
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
    // 20 immediate add-time polls already happened; reset the counter.
    const before = h.script.taskCalls();
    h.tick();
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
    expect(h.script.taskCalls() - before).toBeLessThanOrEqual(16);
    expect(h.script.taskCalls() - before).toBeGreaterThan(0);
  });

  it('mentions the outbox auto-discovery boundary in the static page', async () => {
    const pageModule = await import('../src/page.js');
    expect(pageModule.PAGE_HTML).toContain('自动发现的边界');
    expect(pageModule.PAGE_HTML).toContain('需手动输入任务ID与 peerId');
    // Serialization primitives required by the P1 fix must stay in the script.
    expect(PAGE_JS).toContain('inFlight');
    expect(PAGE_JS).toContain('generation');
  });

  it('keeps the page script free of raw-HTML sinks and eval', async () => {
    const pageModule = await import('../src/page.js');
    expect(pageModule.PAGE_JS).not.toContain('innerHTML');
    expect(pageModule.PAGE_JS).not.toContain('eval(');
    expect(pageModule.PAGE_HTML).not.toContain('${');
  });
});
