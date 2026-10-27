import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin(), { name: 'copy-profile-parser-workers', closeBundle() { const target = join(process.cwd(), 'out', 'main'); mkdirSync(target, { recursive: true }); for (const worker of ['profile-pdf-worker.cjs', 'profile-docx-worker.cjs']) copyFileSync(join(process.cwd(), 'src', 'main', worker), join(target, worker)) } }] },
  preload: { build: { externalizeDeps: false } },
  renderer: { resolve: { dedupe: ['react', 'react-dom'] }, plugins: [react(), tailwindcss()] }
})
