import { expect, test } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCoverLetterAuthority } from '../src/main/cover-letter-authority'
import { artifactFixture } from './helpers/cover-letter-artifact'

test('damaged or missing letter keys never authenticate old receipts or overwrite invalid bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'letter-authority-')), path = join(dir, 'cover-letter-local-authority.key')
  try {
    const material = { synthetic: true }
    const seal = createCoverLetterAuthority(dir).seal('measurement', material)
    expect(createCoverLetterAuthority(dir).verify('measurement', material, seal)).toBe(true)
    writeFileSync(path, Buffer.alloc(0))
    const damaged = createCoverLetterAuthority(dir)
    expect(damaged.verify('measurement', material, seal)).toBe(false)
    expect(() => damaged.seal('measurement', material)).toThrow(/cover-letter.*key/i)
    expect(readFileSync(path)).toHaveLength(0)
    rmSync(path)
    const missing = createCoverLetterAuthority(dir)
    expect(missing.verify('measurement', material, seal)).toBe(false)
    const replacement = missing.seal('measurement', material)
    expect(replacement).not.toBe(seal)
    expect(missing.verify('measurement', material, seal)).toBe(false)
    expect(createCoverLetterAuthority(dir).verify('measurement', material, replacement)).toBe(true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('damaged independent letter key permits workspace reopen and profile/CV/backup, but refuses old letter authority', async () => {
  const f = await artifactFixture()
  const path = join(f.dir, 'cover-letter-local-authority.key')
  try {
    const input = { jobId: f.jobId, letterId: f.letter.id }
    expect((await f.wb.api.measureCoverLetter(input)).ok).toBe(true)
    for (const paragraph of f.letter.paragraphs) expect((await f.wb.api.acknowledgeCoverLetterParagraph({ ...input, paragraphId: paragraph.id, acknowledged: true })).ok).toBe(true)
    expect((await f.wb.api.approveCoverLetter(f.jobId, f.letter.id)).ok).toBe(true)
    const profile = await f.wb.api.getProfile(), cv = await f.wb.api.getDraft(f.jobId), count = f.prompts.length
    f.wb.close()
    writeFileSync(path, Buffer.alloc(0))
    f.reopen()
    expect(await f.wb.api.getProfile()).toEqual(profile)
    expect(await f.wb.api.getDraft(f.jobId)).toEqual(cv)
    expect(() => f.wb.backup.previewRestore(f.wb.backup.createBackup())).not.toThrow()
    const state = await f.wb.api.getCoverLetterReadModel(f.jobId)
    expect(state.readiness).toMatchObject({ currentFit: null, approved: false, canApprove: false, canExport: false, bindingProblem: expect.stringMatching(/cover-letter.*key/i) })
    expect(await f.wb.api.measureCoverLetter(input)).toMatchObject({ ok: false, message: expect.stringMatching(/cover-letter.*key/i) })
    expect((await f.wb.api.approveCoverLetter(f.jobId, f.letter.id)).ok).toBe(false)
    expect(readFileSync(path)).toHaveLength(0)
    rmSync(path)
    f.reopen()
    expect((await f.wb.api.getCoverLetterReadModel(f.jobId)).readiness).toMatchObject({ currentFit: null, approved: false, canApprove: false, canExport: false })
    expect((await f.wb.api.approveCoverLetter(f.jobId, f.letter.id)).ok).toBe(false)
    expect(f.prompts).toHaveLength(count)
  } finally { f.cleanup() }
}, 30_000)
