import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electronSimple from 'vite-plugin-electron/simple'

export default defineConfig(async () => ({
  resolve: {
    dedupe: ['katex'],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    include: ['katex', 'katex/contrib/auto-render'],
  },
  plugins: [
    react(),
    ...(await electronSimple({
      main: {
        entry: 'electron/main.ts',
        onstart({ startup }) {
          startup()
        },
        vite: {
          build: {
            lib: {
              entry: 'electron/main.ts',
              formats: ['cjs'],
              fileName: () => 'main.cjs',
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
      },
    })),
  ],
}))
