import { defineConfig } from 'vite';
import { webImportBoundaryPlugin } from './web-import-boundary.js';

const proxy = {
  '/api/v1': {
    target: process.env.BETWEENLY_GATEWAY_URL || 'http://127.0.0.1:5088',
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [webImportBoundaryPlugin],
  server: {
    allowedHosts: ['frp-toe.com'],
    proxy,
  },
  preview: {
    allowedHosts: ['frp-toe.com'],
    proxy,
  },
});
