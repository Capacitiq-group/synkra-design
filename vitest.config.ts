import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./studio/test/setup.ts'],
    include: ['studio/**/*.test.{ts,tsx}'],
    css: false,
    environmentOptions: {
      jsdom: {
        // Never resolve relative fetches against the live dev server (port 3000): tests must
        // only talk to MSW. A dead port guarantees a hard failure instead of a cross-talk.
        url: 'http://localhost:49153/',
      },
    },
  },
  resolve: {
    alias: [
      { find: /^@\/test\/(.*)/, replacement: path.resolve(__dirname, 'studio/test/$1') },
      { find: /^@\/(.*)/, replacement: path.resolve(__dirname, 'studio/$1') },
    ],
  },
})
