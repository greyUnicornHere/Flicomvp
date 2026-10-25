import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const webPort = Number(process.env.WEB_PORT ?? 5173);
const apiPort = Number(process.env.PORT ?? 3001);

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
  server: {
    host: 'localhost',
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
    },
  },
});
