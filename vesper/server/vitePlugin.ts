import type { Plugin } from 'vite';
import { createApp } from './app';
import { logStore } from './lib/logger';

/**
 * Mounts the real Express backend inside the Vite dev server.
 *
 * One process, one port, no CORS, and the browser only ever uses relative
 * /api URLs — which is what makes the sandboxed preview work. The exact same
 * Express app also runs standalone via `npm run server` (server/standalone.ts)
 * for production, so dev and prod exercise identical route code.
 */
export function vesperApiPlugin(): Plugin {
  return {
    name: 'vesper-api',
    configureServer(server) {
      const app = createApp();
      server.middlewares.use(app);

      const started = Date.now();
      logStore.push('system', 'Vesper API mounted into the Vite dev server');

      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address();
        const port = typeof address === 'object' && address ? address.port : '?';
        // eslint-disable-next-line no-console
        console.log(`\n  vesper api   ready on port ${port} in ${Date.now() - started}ms\n`);
      });
    },
  };
}
