import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin(), { name: 'copy-profile-pdf-worker', closeBundle() { const target = join(process.cwd(), 'out', 'main'); mkdirSync(target, { recursive: true }); copyFileSync(join(process.cwd(), 'src', 'main', 'profile-pdf-worker.cjs'), join(target, 'profile-pdf-worker.cjs')) } }] },
  preload: { build: { externalizeDeps: false } },
  renderer: { plugins: [react(), tailwindcss()] }
})
