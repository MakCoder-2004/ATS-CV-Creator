import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { captureLetterDestination, commitLetterDestination } from '../src/main/cover-letter-destination'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'letter destination test '))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const commit = (handle: ReturnType<typeof captureLetterDestination>, bytes: Uint8Array = Buffer.from('new document'), overwriteApproved = false, beforeCommit: () => undefined = () => undefined) =>
  commitLetterDestination(handle, bytes, { overwriteApproved, beforeCommit })

describe('cover letter destination capture and commit', () => {
  it('creates an absent destination without clobbering', () => {
    const root = fixture()
    const path = join(root, 'letter with spaces.pdf')
    const handle = captureLetterDestination(path)
    expect(handle.exists).toBe(false)
    commit(handle)
    expect(readFileSync(path)).toEqual(Buffer.from('new document'))
  })

  it('requires explicit overwrite approval and consumes the refused capture', () => {
    const root = fixture()
    const path = join(root, 'letter.pdf')
    writeFileSync(path, 'old')
    const refused = captureLetterDestination(path)
    expect(() => commit(refused)).toThrow(expect.objectContaining({ code: 'OVERWRITE_REQUIRED' }))
    expect(readFileSync(path, 'utf8')).toBe('old')
    expect(readdirSync(root)).toEqual(['letter.pdf'])
    expect(() => commit(refused, Buffer.from('replacement'), true)).toThrow(expect.objectContaining({ code: 'INVALID_CAPTURE' }))
    expect(readFileSync(path, 'utf8')).toBe('old')

    const approved = captureLetterDestination(path)
    commit(approved, Buffer.from('replacement'), true)
    expect(readFileSync(path, 'utf8')).toBe('replacement')
  })

  it('requires explicit overwrite approval and replaces an unchanged approved file', () => {
    const root = fixture()
    const path = join(root, 'letter.pdf')
    writeFileSync(path, 'old')
    const handle = captureLetterDestination(path)
    expect(() => commit(handle)).toThrow()
    expect(readFileSync(path, 'utf8')).toBe('old')
    const approved = captureLetterDestination(path)
    commit(approved, Buffer.from('replacement'), true)
    expect(readFileSync(path, 'utf8')).toBe('replacement')
  })

  it.each(['created', 'deleted', 'replaced', 'modified'])('refuses a destination that was %s after capture', (change) => {
    const root = fixture()
    const path = join(root, 'letter.pdf')
    if (change !== 'created') writeFileSync(path, 'old bytes')
    const handle = captureLetterDestination(path)
    if (change === 'created') writeFileSync(path, 'intruder')
    if (change === 'deleted') rmSync(path)
    if (change === 'replaced') { rmSync(path); writeFileSync(path, 'old bytes') }
    if (change === 'modified') writeFileSync(path, 'new bytes')
    const before = (() => { try { return readFileSync(path) } catch { return null } })()
    expect(() => commit(handle, Buffer.from('output'), true)).toThrow(expect.objectContaining({ code: 'DESTINATION_CHANGED' }))
    expect((() => { try { return readFileSync(path) } catch { return null } })()).toEqual(before)
    expect(() => commit(handle, Buffer.from('retry'), true)).toThrow(expect.objectContaining({ code: 'INVALID_CAPTURE' }))
    expect((() => { try { return readFileSync(path) } catch { return null } })()).toEqual(before)
  })

  it('detects same-size content changes even when mtime is restored', () => {
    const root = fixture()
    const path = join(root, 'letter.pdf')
    writeFileSync(path, 'aaaa')
    const original = statSync(path)
    const handle = captureLetterDestination(path)
    writeFileSync(path, 'bbbb')
    utimesSync(path, original.atime, original.mtime)
    expect(() => commit(handle, Buffer.from('output'), true)).toThrow()
    expect(readFileSync(path, 'utf8')).toBe('bbbb')
  })

  it('runs the synchronous document guard before writing and cleans up on guard failure', () => {
    const root = fixture()
    const path = join(root, 'letter.pdf')
    const handle = captureLetterDestination(path)
    expect(() => commitLetterDestination(handle, Buffer.from('output'), { overwriteApproved: false, beforeCommit: () => { throw new Error('stale') } })).toThrow(expect.objectContaining({ code: 'GUARD_FAILED' }))
    expect(() => commit(handle)).toThrow(expect.objectContaining({ code: 'INVALID_CAPTURE' }))
    expect(() => readFileSync(path)).toThrow()
    expect(readdirSync(root)).toEqual([])
    const fresh = captureLetterDestination(path)
    expect(() => commit(fresh)).not.toThrow()
    expect(readFileSync(path, 'utf8')).toBe('new document')
    expect(() => commit(fresh)).toThrow()
  })

  it('rejects asynchronous and non-void guards without committing', async () => {
    const root = fixture()
    const path = join(root, 'letter.pdf')
    const asyncHandle = captureLetterDestination(path)
    const pending = Promise.reject(new Error('late guard'))
    expect(() => commitLetterDestination(asyncHandle, Buffer.from('output'), { overwriteApproved: false, beforeCommit: (() => pending) as unknown as () => undefined })).toThrow(expect.objectContaining({ code: 'GUARD_FAILED' }))
    expect(() => commit(asyncHandle)).toThrow(expect.objectContaining({ code: 'INVALID_CAPTURE' }))
    expect(() => readFileSync(path)).toThrow()
    expect(readdirSync(root)).toEqual([])

    const nonVoidHandle = captureLetterDestination(path)
    expect(() => commitLetterDestination(nonVoidHandle, Buffer.from('output'), { overwriteApproved: false, beforeCommit: (() => true) as unknown as () => undefined })).toThrow(expect.objectContaining({ code: 'GUARD_FAILED' }))
    expect(() => commit(nonVoidHandle)).toThrow(expect.objectContaining({ code: 'INVALID_CAPTURE' }))
    await expect(pending).rejects.toThrow('late guard')
    expect(() => readFileSync(path)).toThrow()
    expect(readdirSync(root)).toEqual([])
  })

  it('does not accept forged or reused capture handles', () => {
    const root = fixture()
    const path = join(root, 'letter.pdf')
    const handle = captureLetterDestination(path)
    expect(() => commit({ exists: false } as ReturnType<typeof captureLetterDestination>, Buffer.from('x'), false)).toThrow()
    commit(handle)
    expect(() => commit(handle)).toThrow()
  })

  it('consumes captures after invalid payload and invalid options refusals', () => {
    const root = fixture()
    const path = join(root, 'letter.pdf')
    const invalidBytes = captureLetterDestination(path)
    expect(() => commit(invalidBytes, Buffer.alloc(0))).toThrow(expect.objectContaining({ code: 'INVALID_BYTES' }))
    expect(() => commit(invalidBytes, Buffer.from('retry'))).toThrow(expect.objectContaining({ code: 'INVALID_CAPTURE' }))
    expect(() => readFileSync(path)).toThrow()
    expect(readdirSync(root)).toEqual([])

    const invalidOptions = captureLetterDestination(path)
    expect(() => commitLetterDestination(invalidOptions, Buffer.from('output'), null as never)).toThrow(expect.objectContaining({ code: 'GUARD_FAILED' }))
    expect(() => commit(invalidOptions)).toThrow(expect.objectContaining({ code: 'INVALID_CAPTURE' }))
    expect(() => readFileSync(path)).toThrow()
    expect(readdirSync(root)).toEqual([])
  })

  it('rejects invalid payloads, directories and overlong files', () => {
    const root = fixture()
    const path = join(root, 'letter.pdf')
    for (const payload of [Buffer.alloc(0), Buffer.alloc(20 * 1024 * 1024 + 1), 'not bytes'] as const) {
      const handle = captureLetterDestination(path)
      expect(() => commit(handle, payload as Buffer)).toThrow(expect.objectContaining({ code: 'INVALID_BYTES' }))
      expect(() => commit(handle)).toThrow(expect.objectContaining({ code: 'INVALID_CAPTURE' }))
      expect(readdirSync(root)).toEqual([])
    }
    const directory = join(root, 'directory')
    mkdirSync(directory)
    expect(() => captureLetterDestination(directory)).toThrow()
    const large = join(root, 'large')
    writeFileSync(large, Buffer.alloc(20 * 1024 * 1024 + 1))
    expect(() => captureLetterDestination(large)).toThrow()
    expect(() => readFileSync(path)).toThrow()
  })

  it('refuses a leaf symlink when supported', ({ skip }) => {
    const root = fixture()
    const target = join(root, 'real.pdf')
    const path = join(root, 'link.pdf')
    writeFileSync(target, 'safe')
    try {
      symlinkSync(target, path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS') skip(`symlink creation unsupported: ${code}`)
      throw error
    }
    expect(() => captureLetterDestination(path)).toThrow()
    expect(readFileSync(target, 'utf8')).toBe('safe')
  })

  it('uses a bounded temporary basename for long destination names and copies input bytes', () => {
    const root = fixture()
    const path = join(root, `${'x'.repeat(240)}.pdf`)
    const input: Uint8Array = Buffer.from('snapshot')
    const handle = captureLetterDestination(path)
    commitLetterDestination(handle, input, { overwriteApproved: false, beforeCommit: () => { input.fill(0) } })
    input.fill(1)
    expect(readFileSync(path, 'utf8')).toBe('snapshot')
    expect(path.split(/[\\/]/).at(-1)!.length).toBeGreaterThan(240)
  })
})
