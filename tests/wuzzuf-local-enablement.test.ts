import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isWuzzufPersonalLocalEnabled, wuzzufPersonalLocalPolicyPath } from '../src/main/wuzzuf-local-enablement'

const policy = JSON.stringify({ version: 1, wuzzufPersonalLocalEnabled: true, acknowledgedNoticeVersion: 1 })

describe('per-install Wuzzuf local enablement', () => {
  it('defaults off when the owner-controlled appData policy file is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'wuzzuf-policy-'))
    try { expect(isWuzzufPersonalLocalEnabled(root)).toBe(false) } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('enables only for the exact acknowledged versioned local policy', () => {
    const root = mkdtempSync(join(tmpdir(), 'wuzzuf-policy-'))
    try {
      const file = wuzzufPersonalLocalPolicyPath(root)
      mkdirSync(join(root, 'CV Tailor Personal Local Policy'))
      writeFileSync(file, policy, { flag: 'wx' })
      expect(isWuzzufPersonalLocalEnabled(root)).toBe(true)
      writeFileSync(file, JSON.stringify({ version: 1, wuzzufPersonalLocalEnabled: true }), { flag: 'w' })
      expect(isWuzzufPersonalLocalEnabled(root)).toBe(false)
      writeFileSync(file, `${policy} ${' '.repeat(2048)}`, { flag: 'w' })
      expect(isWuzzufPersonalLocalEnabled(root)).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('fails closed for a symlinked policy directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'wuzzuf-policy-'))
    const target = mkdtempSync(join(tmpdir(), 'wuzzuf-policy-target-'))
    try {
      mkdirSync(join(target, 'CV Tailor Personal Local Policy'))
      writeFileSync(wuzzufPersonalLocalPolicyPath(target), policy, { flag: 'wx' })
      symlinkSync(join(target, 'CV Tailor Personal Local Policy'), join(root, 'CV Tailor Personal Local Policy'), 'junction')
      expect(isWuzzufPersonalLocalEnabled(root)).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }) }
  })
})
