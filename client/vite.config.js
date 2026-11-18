import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE: set when embedding in the MCCIA app hub under a sub-path, e.g. VITE_BASE=/attendance/
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
