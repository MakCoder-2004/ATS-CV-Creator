import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: { alias: { '@gallery': resolve(__dirname, 'src') } },
  server: { port: 5178, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
})
