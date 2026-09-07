import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';
import { resolve } from 'node:path';

/**
 * Remotes are NOT listed here — URLs come from /config.json at runtime.
 * Federation plugin still marks React as a shared singleton for hosted remotes.
 */
export default defineConfig({
  base: '/',
  plugins: [
    react(),
    federation({
      name: 'shell',
      filename: 'remoteEntry.js',
      remotes: {},
      shared: {
        react: { singleton: true, requiredVersion: '^18.3.1' },
        'react-dom': { singleton: true, requiredVersion: '^18.3.1' },
      },
    }),
  ],
  resolve: {
    alias: {
      '@baseline/contracts': resolve(__dirname, '../../packages/contracts/src/index.ts'),
    },
  },
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
    modulePreload: false,
  },
  server: {
    port: 3000,
    cors: true,
  },
  preview: {
    port: 3000,
    cors: true,
  },
});
