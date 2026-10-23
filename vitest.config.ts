import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['packages/*/test/**/*.test.ts'], testTimeout: 5000 }, resolve: { alias: {
  '@lam/domain': fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url)),
  '@lam/protocol': fileURLToPath(new URL('./packages/protocol/src/index.ts', import.meta.url)),
  '@lam/adapter-sdk': fileURLToPath(new URL('./packages/adapter-sdk/src/index.ts', import.meta.url)),
  '@lam/mock-adapter': fileURLToPath(new URL('./packages/mock-adapter/src/index.ts', import.meta.url)),
} } });
