import { createMockAdapter } from '@lam/mock-adapter';
const adapter = createMockAdapter();
const [agent] = await adapter.discover();
if (!agent) throw new Error('Mock agent unavailable');
const session = await adapter.spawn({ agentId: agent.id, workspaceAlias: 'project-a' });
await adapter.send({ sessionId: session.id, taskId: 'demo-task', text: 'Hello LAN Agent Mesh', idempotencyKey: 'demo-key', deadline: new Date(Date.now() + 5000).toISOString() });
for await (const event of adapter.watch('demo-task')) console.log(JSON.stringify(event));
