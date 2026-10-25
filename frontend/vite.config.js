import { defineConfig } from 'vite';

const proxy = {
  '/api/v1': {
    target: 'http://127.0.0.1:5080',
    changeOrigin: true,
  },
};

export default defineConfig({
  server: {
    allowedHosts: ['frp-toe.com'],
    proxy,
  },
  preview: {
    allowedHosts: ['frp-toe.com'],
    proxy,
  },
});
