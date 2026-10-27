import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isWuzzufPersonalLocalEnabled, wuzzufInstallationFingerprint, wuzzufPersonalLocalPolicyPath } from '../src/main/wuzzuf-local-enablement'

const policy = (installationRoot: string) => JSON.stringify({ version: 1, wuzzufPersonalLocalEnabled: true, acknowledgedNoticeVersion: 1, installationFingerprint: wuzzufInstallationFingerprint(installationRoot) })

describe('per-install Wuzzuf local enablement', () => {
  it('defaults off when the owner-controlled appData policy file is absent', () => {
    const appData = mkdtempSync(join(tmpdir(), 'wuzzuf-policy-'))
    const install = mkdtempSync(join(tmpdir(), 'wuzzuf-install-'))
    try { expect(isWuzzufPersonalLocalEnabled(appData, install)).toBe(false) } finally { rmSync(appData, { recursive:true, force:true }); rmSync(install, { recursive:true, force:true }) }
  })
  it('binds one shared appData policy to exactly one physical installation without storing the root path', () => {
    const appData = mkdtempSync(join(tmpdir(), 'wuzzuf-policy-'))
    const installA = mkdtempSync(join(tmpdir(), 'wuzzuf-install-a-'))
    const installB = mkdtempSync(join(tmpdir(), 'wuzzuf-install-b-'))
    const installAlias = join(appData, 'install-alias')
    try {
      const file = wuzzufPersonalLocalPolicyPath(appData)
      mkdirSync(join(appData, 'CV Tailor Personal Local Policy'))
      const serialized = policy(installA)
      writeFileSync(file, serialized, { flag:'wx' })
      expect(serialized).not.toContain(installA)
      expect(isWuzzufPersonalLocalEnabled(appData, installA)).toBe(true)
      symlinkSync(installA, installAlias, 'junction')
      expect(isWuzzufPersonalLocalEnabled(appData, installAlias)).toBe(true)
      expect(isWuzzufPersonalLocalEnabled(appData, installB)).toBe(false)
      writeFileSync(file, JSON.stringify({ version:1, wuzzufPersonalLocalEnabled:true, acknowledgedNoticeVersion:1, installationFingerprint:installA }), { flag:'w' })
      expect(isWuzzufPersonalLocalEnabled(appData, installB)).toBe(false)
      writeFileSync(file, `${policy(installA)}${' '.repeat(2048)}`, { flag:'w' })
      expect(isWuzzufPersonalLocalEnabled(appData, installA)).toBe(false)
    } finally {
      rmSync(appData, { recursive:true, force:true })
      rmSync(installA, { recursive:true, force:true }); rmSync(installB, { recursive:true, force:true }); rmSync(installAlias, { recursive:true, force:true })
    }
  })
  it('fails closed for a symlinked policy directory', () => {
    const appData = mkdtempSync(join(tmpdir(), 'wuzzuf-policy-'))
    const target = mkdtempSync(join(tmpdir(), 'wuzzuf-policy-target-'))
    const install = mkdtempSync(join(tmpdir(), 'wuzzuf-install-'))
    try {
      mkdirSync(join(target, 'CV Tailor Personal Local Policy'))
      writeFileSync(wuzzufPersonalLocalPolicyPath(target), policy(install), { flag:'wx' })
      symlinkSync(join(target, 'CV Tailor Personal Local Policy'), join(appData, 'CV Tailor Personal Local Policy'), 'junction')
      expect(isWuzzufPersonalLocalEnabled(appData, install)).toBe(false)
    } finally {
      rmSync(appData, { recursive:true, force:true }); rmSync(target, { recursive:true, force:true }); rmSync(install, { recursive:true, force:true })
    }
  })
})
