import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DomainGraphSchema, RegistryCacheSchema, WorkspaceAliasSchema, isCacheAvailable } from '../src/index.js';
const fixture = () => JSON.parse(readFileSync(new URL('../fixtures/graph.json', import.meta.url), 'utf8'));
describe('domain ownership', () => {
  it('validates a complete graph fixture', () => { expect(DomainGraphSchema.parse(fixture()).tasks).toHaveLength(1); });
  it.each(['../secret', '/tmp/work', 'C:\\work', 'a/b', '.', ''])('rejects unsafe workspace %s', value => {
    expect(WorkspaceAliasSchema.safeParse(value).success).toBe(false);
  });
  it('rejects foreign owners, missing parents, duplicate IDs and capability escalation', () => {
    const changes = [
      (f: ReturnType<typeof fixture>) => { f.registry.harnesses[0].nodeId = 'win'; },
      (f: ReturnType<typeof fixture>) => { f.registry.agents[0].harnessId = 'missing'; },
      (f: ReturnType<typeof fixture>) => { f.sessions[0].workspaceAlias = 'unregistered'; },
      (f: ReturnType<typeof fixture>) => { f.tasks[0].agentId = 'win/agent'; },
      (f: ReturnType<typeof fixture>) => { f.tasks.push(f.tasks[0]); },
      (f: ReturnType<typeof fixture>) => { f.registry.agents[0].capabilities.attachExistingGui = 'supported'; },
      (f: ReturnType<typeof fixture>) => { f.tasks[0].delegationDepth = 9; },
      (f: ReturnType<typeof fixture>) => { f.registry.node.unexpected = true; },
    ];
    for (const change of changes) { const f = fixture(); change(f); expect(DomainGraphSchema.safeParse(f).success).toBe(false); }
  });
  it('expires cached registry availability', () => {
    const cache = RegistryCacheSchema.parse({ registry: fixture().registry, receivedAt: '2026-10-23T00:00:00Z', expiresAt: '2026-10-23T00:01:00Z' });
    expect(isCacheAvailable(cache, Date.parse('2026-10-23T00:00:30Z'))).toBe(true);
    expect(isCacheAvailable(cache, Date.parse(cache.expiresAt))).toBe(false);
    expect(RegistryCacheSchema.safeParse({ ...cache, expiresAt: cache.receivedAt }).success).toBe(false);
  });
});
