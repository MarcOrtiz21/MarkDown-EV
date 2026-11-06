import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('./preview-host', import.meta.url)),
  base: './',
  publicDir: false,
  resolve: {
    dedupe: ['katex'],
  },
  build: {
    outDir: fileURLToPath(new URL('./MarkDownEV-Swift/Resources/Preview', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 3000,
  },
})
