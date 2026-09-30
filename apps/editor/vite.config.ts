import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const api = `http://localhost:${process.env.PF_API_PORT ?? 4000}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@pixelforge/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
    },
  },
  server: {
    port: Number(process.env.PF_EDITOR_PORT ?? 5173),
    strictPort: true,
    host: 'localhost',
    proxy: { '/api': api, '/fixtures': api },
  },
});
