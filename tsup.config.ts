import { defineConfig } from 'tsup';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Recursively patch .js files to fix bare sqlite imports. */
function patchSqliteImports(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      patchSqliteImports(fullPath);
    } else if (fullPath.endsWith('.js')) {
      const content = readFileSync(fullPath, 'utf-8');
      if (content.includes('from "sqlite"') || content.includes("from 'sqlite'")) {
        const patched = content
          .replace(/from "sqlite"/g, 'from "node:sqlite"')
          .replace(/from 'sqlite'/g, "from 'node:sqlite'");
        writeFileSync(fullPath, patched);
      }
    }
  }
}

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'server/index': 'src/server/index.ts',
    'scripts/on-permission-request': 'scripts/on-permission-request.ts',
    'scripts/on-pre-tool-use': 'scripts/on-pre-tool-use.ts',
    'scripts/on-stop': 'scripts/on-stop.ts',
    'scripts/on-post-tool-failure': 'scripts/on-post-tool-failure.ts',
    'scripts/on-task-completed': 'scripts/on-task-completed.ts',
    'scripts/lib/bridge-client': 'scripts/lib/bridge-client.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  outDir: 'dist',
  // Bundle ALL npm dependencies into dist/ for self-contained plugin.
  // The regex matches any module that is NOT a node: prefixed builtin,
  // so npm packages get bundled while node:fs, node:sqlite etc. stay external.
  noExternal: [/^(?!node:)/],
  // Fix esbuild stripping node: prefix from node:sqlite imports.
  // node:sqlite is the only builtin that requires the prefix.
  onSuccess: () => {
    patchSqliteImports('dist');
  },
});
