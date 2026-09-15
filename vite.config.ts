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
        vite: {
          build: {
            rollupOptions: {
              output: {
                // package.json uses ESM, but Electron's preload bridge is
                // bundled as CommonJS because it uses contextBridge/require.
                // Keep the extension explicit so Node does not parse CJS as ESM.
                entryFileNames: 'preload.cjs',
              },
            },
          },
        },
      },
    })),
  ],
}))
