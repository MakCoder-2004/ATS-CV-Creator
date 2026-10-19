import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: './tests/electron', timeout: 30000, workers: 1 })
