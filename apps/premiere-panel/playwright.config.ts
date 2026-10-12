import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests',
  testMatch: '*.harness.spec.ts',
  timeout: 60_000,
  reporter: 'list',
  outputDir: 'test-results'
})
