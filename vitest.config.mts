import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    passWithNoTests: true,
    // Agent worktrees hold full copies of the repo.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
})
