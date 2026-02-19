import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/server/index.ts',
    'scripts/on-permission-request.ts',
    'scripts/on-pre-tool-use.ts',
    'scripts/on-stop.ts',
    'scripts/on-post-tool-failure.ts',
    'scripts/lib/bridge-client.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  outDir: 'dist',
  external: ['better-sqlite3', '@slack/bolt'],
});
