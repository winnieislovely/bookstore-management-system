import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Staff app (TDD §3.2): served under the same origin as the API, so the session cookie is first-party. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/pos/v1': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
});
