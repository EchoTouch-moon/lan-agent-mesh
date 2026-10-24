import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['packages/*/test/**/*.test.ts'], testTimeout: process.platform === 'win32' ? 60000 : 15000 }, resolve: { alias: {
  '@lam/private-storage': fileURLToPath(new URL('./packages/private-storage/src/index.ts', import.meta.url)),
  '@lam/storage': fileURLToPath(new URL('./packages/storage/src/index.ts', import.meta.url)),
  '@lam/mesh': fileURLToPath(new URL('./packages/mesh/src/index.ts', import.meta.url)),
  '@lam/runtime': fileURLToPath(new URL('./packages/runtime/src/index.ts', import.meta.url)),
  '@lam/mcp-contract': fileURLToPath(new URL('./packages/mcp-contract/src/index.ts', import.meta.url)),
  '@lam/mcp-server': fileURLToPath(new URL('./packages/mcp-server/src/index.ts', import.meta.url)),
  '@lam/domain': fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url)),
  '@lam/protocol': fileURLToPath(new URL('./packages/protocol/src/index.ts', import.meta.url)),
  '@lam/adapter-sdk': fileURLToPath(new URL('./packages/adapter-sdk/src/index.ts', import.meta.url)),
  '@lam/mock-adapter': fileURLToPath(new URL('./packages/mock-adapter/src/index.ts', import.meta.url)),
} } });
