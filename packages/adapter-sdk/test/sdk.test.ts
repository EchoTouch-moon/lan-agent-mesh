import { describe, expect, it } from 'vitest';
import { AdapterClient, negotiateCapabilities } from '../src/index.js';
import { MOCK_CAPABILITIES } from '@lam/mock-adapter';
describe('capability gates', () => {
  const partial = { ...MOCK_CAPABILITIES, spawn: 'unknown' as const, send: 'unsupported' as const, watch: 'unsupported' as const, resume: 'unsupported' as const, cancel: 'unsupported' as const, answerPermission: 'unsupported' as const };
  it('permits supported operations and rejects missing/unknown features', async () => {
    const adapter = new AdapterClient('partial/1', partial, { discover: async () => [] });
    expect(await adapter.discover()).toEqual([]);
    await expect(adapter.spawn({ agentId: 'a', workspaceAlias: 'project-a' })).rejects.toMatchObject({ code: 'unsupported' });
    await expect(adapter.cancel('t')).rejects.toMatchObject({ code: 'unsupported' });
    await expect(adapter.watch('t')[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'unsupported' });
  });
  it('rejects advertised methods without implementations', () => {
    expect(() => new AdapterClient('bad', MOCK_CAPABILITIES, {})).toThrowError(expect.objectContaining({ code: 'invalid_message' }));
  });
  it('negotiates conservatively and protects declarations from mutation', async () => {
    const result = negotiateCapabilities(MOCK_CAPABILITIES, partial);
    expect(result.spawn).toBe('unknown'); expect(result.send).toBe('unsupported');
    const adapter = new AdapterClient('partial', partial, { discover: async () => [] });
    (await adapter.probe()).capabilities.spawn = 'supported';
    expect((await adapter.probe()).capabilities.spawn).toBe('unknown');
  });
});
