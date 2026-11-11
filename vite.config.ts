import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // The dev site calls /api on its own address and Vite forwards it to the API server.
    // Calling localhost:3001 directly breaks when the site is opened through a tunnel or
    // another device: the browser blocks a public page from reaching localhost.
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})

