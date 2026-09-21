import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this as a project page at /State-Machine-Visualizer/, not the domain
  // root, so every asset URL the build emits needs that prefix. The dev server still serves
  // from root, so this only applies to `vite build`.
  base: command === 'build' ? '/State-Machine-Visualizer/' : '/',
  plugins: [react()],
  test: {
    environment: 'node',
    // e2e/ holds Playwright specs (run via `npm run test:e2e`), not Vitest ones — both use
    // the *.spec.ts naming convention, so Vitest's default include glob would otherwise pick them up.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
}))
