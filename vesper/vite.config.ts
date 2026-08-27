import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { vesperApiPlugin } from './server/vitePlugin';

export default defineConfig({
  plugins: [react(), vesperApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // The preview host is not localhost, so accept any origin in dev.
    allowedHosts: true,
    // Leave HMR unconfigured: Vite connects to the page's own origin, so it
    // works over the https preview proxy (wss) and on plain localhost alike.
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          icons: ['lucide-react'],
        },
      },
    },
  },
});
