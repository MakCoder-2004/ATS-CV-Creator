import { defineConfig } from 'vitest/config'
export default defineConfig({ cacheDir: '.audit/job-research-vite-cache', test: { include: ['tests/job-research*.test.ts'], maxWorkers: 1 } })
