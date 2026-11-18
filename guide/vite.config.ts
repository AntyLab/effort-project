import { defineConfig } from 'vite';

export default defineConfig({
  // The last chapter imports Effort's real rules read-only from ../src/policy.mjs.
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
