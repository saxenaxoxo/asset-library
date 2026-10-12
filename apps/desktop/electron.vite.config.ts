import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = {
  '@shared': resolve('src/shared'),
  '@brand': resolve('../../packages/branding'),
  '@catalog': resolve('../../packages/catalog')
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          worker: resolve('src/main/worker/index.ts')
        }
      }
    }
  },
  preload: {
    resolve: { alias }
  },
  renderer: {
    resolve: {
      alias: { ...alias, '@renderer': resolve('src/renderer/src') }
    },
    plugins: [react(), tailwindcss()]
  }
})
