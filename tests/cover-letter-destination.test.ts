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
    expect(() => commit(handle, Buffer.from('output'), true)).toThrow()
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
    expect(() => commitLetterDestination(handle, Buffer.from('output'), { overwriteApproved: false, beforeCommit: () => { throw new Error('stale') } })).toThrow()
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
    const handle = captureLetterDestination(path)
    const pending = Promise.reject(new Error('late guard'))
    expect(() => commitLetterDestination(handle, Buffer.from('output'), { overwriteApproved: false, beforeCommit: (() => pending) as unknown as () => undefined })).toThrow()
    expect(() => commitLetterDestination(handle, Buffer.from('output'), { overwriteApproved: false, beforeCommit: (() => true) as unknown as () => undefined })).toThrow()
    await expect(pending).rejects.toThrow('late guard')
    expect(() => readFileSync(path)).toThrow()
  })

  it('does not accept forged or reused capture handles', () => {
    const root = fixture()
    const path = join(root, 'letter.pdf')
    const handle = captureLetterDestination(path)
    expect(() => commit({ exists: false } as ReturnType<typeof captureLetterDestination>, Buffer.from('x'), false)).toThrow()
    commit(handle)
    expect(() => commit(handle)).toThrow()
  })

  it('rejects invalid payloads, directories and overlong files', () => {
    const root = fixture()
    const path = join(root, 'letter.pdf')
    const handle = captureLetterDestination(path)
    expect(() => commit(handle, Buffer.alloc(0))).toThrow()
    expect(() => commit(handle, Buffer.alloc(20 * 1024 * 1024 + 1))).toThrow()
    expect(() => commit(handle, 'not bytes' as unknown as Buffer)).toThrow()
    const directory = join(root, 'directory')
    mkdirSync(directory)
    expect(() => captureLetterDestination(directory)).toThrow()
    const large = join(root, 'large')
    writeFileSync(large, Buffer.alloc(20 * 1024 * 1024 + 1))
    expect(() => captureLetterDestination(large)).toThrow()
    expect(() => readFileSync(path)).toThrow()
  })

  it('refuses a leaf symlink when supported', () => {
    const root = fixture()
    const target = join(root, 'real.pdf')
    const path = join(root, 'link.pdf')
    writeFileSync(target, 'safe')
    try { symlinkSync(target, path) } catch { return }
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
