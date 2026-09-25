import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@tendril/connector-sdk': new URL('./sdk/src/index.ts', import.meta.url).pathname } },
  test: { include: ['connector/test/**/*.test.ts'] },
});
