import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], charts: ['recharts'] } },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': api, '/t/': api, '/u/': api },
  },
});
