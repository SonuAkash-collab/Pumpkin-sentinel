import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname),
  server: {
    port: 5173,
    open: false
  },
  // Keep CDN imports as-is; disable dep discovery to avoid unnecessary pre-bundling
  optimizeDeps: {
    noDiscovery: true
  }
});
