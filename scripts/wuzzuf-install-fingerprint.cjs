#!/usr/bin/env node
const { createHash } = require('node:crypto')
const { realpathSync } = require('node:fs')

const root = process.argv[2]
if (!root) {
  console.error('Usage: node scripts/wuzzuf-install-fingerprint.cjs <physical-install-root>')
  process.exitCode = 2
} else {
  try {
    const physical = realpathSync.native(root)
    const normalized = process.platform === 'win32' ? physical.toLocaleLowerCase('en-US') : physical
    process.stdout.write(`${createHash('sha256').update(normalized, 'utf8').digest('hex')}\n`)
  } catch {
    console.error('The installation root must exist and resolve to a physical path.')
    process.exitCode = 2
  }
}
