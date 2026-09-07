import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';
import { resolve } from 'node:path';

export default defineConfig({
  base: '/people/',
  plugins: [
    react(),
    federation({
      name: 'people',
      filename: 'remoteEntry.js',
      exposes: {
        './App': './src/bootstrapApp.tsx',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^18.3.1' },
        'react-dom': { singleton: true, requiredVersion: '^18.3.1' },
      },
    }),
  ],
  resolve: {
    alias: {
      '@baseline/contracts': resolve(__dirname, '../../packages/contracts/src/index.ts'),
      '@baseline/domain': resolve(__dirname, '../../packages/domain/src/index.ts'),
    },
  },
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
    modulePreload: false,
  },
  server: {
    port: 3001,
    cors: true,
    origin: 'http://localhost:3001',
  },
  preview: {
    port: 3001,
    cors: true,
  },
});
