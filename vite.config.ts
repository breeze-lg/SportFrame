import { defineConfig } from 'vitest/config'

export default defineConfig({
  // GitHub Pages serves a *project* site under /SportFrame/, while local dev and the
  // pixel suite live at /. One env var decides it, so the deployed build and the
  // tested build cannot disagree about where they are — see .github/workflows/pages.yml.
  base: process.env.PAGES_BASE ?? '/',
  build: { target: 'es2022' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
})
