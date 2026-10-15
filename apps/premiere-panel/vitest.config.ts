import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@catalog': resolve('../../packages/catalog'),
      '@brand': resolve('../../packages/branding')
    }
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' }
})
