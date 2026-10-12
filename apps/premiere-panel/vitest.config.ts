import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@catalog': resolve('../../packages/catalog') } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' }
})
