import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { closeSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Local receipts are not backup/renderer authority. The key never leaves main's userData. */
export function createCoverLetterAuthority(userData: string) {
  const path = join(userData, 'cover-letter-local-authority.key')
  let key: Buffer | undefined
  let problem: string | null = null
  const unavailable = 'The local cover-letter authority key is damaged or unreadable. Letter measurement and approval are unavailable; profile, CV and backup remain available.'
  function load() {
    const info = lstatSync(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size !== 32) throw new Error(unavailable)
    const bytes = readFileSync(path)
    if (bytes.length !== 32) throw new Error(unavailable)
    return bytes
  }
  try { key = load() } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') problem = unavailable }
  function ensureKey() {
    if (problem) throw new Error(problem)
    if (key) return key
    const candidate = randomBytes(32)
    const temporary = join(userData, `.cover-letter-authority-${randomBytes(16).toString('hex')}.tmp`)
    let fd: number | undefined, owned = false
    try {
      fd = openSync(temporary, 'wx', 0o600); owned = true
      writeFileSync(fd, candidate); fsyncSync(fd); closeSync(fd); fd = undefined
      // Publish only complete bytes, without replacing an existing (possibly invalid) key.
      try { linkSync(temporary, path); key = candidate }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; key = load() }
      return key
    } catch { problem = unavailable; throw new Error(problem) }
    finally { try { if (fd !== undefined) closeSync(fd) } finally { if (owned) unlinkSync(temporary) } }
  }
  const message = (purpose: 'measurement' | 'approval', material: unknown) => JSON.stringify({ version: 1, purpose, material })
  return {
    get problem() { return problem },
    seal(purpose: 'measurement' | 'approval', material: unknown) { return createHmac('sha256', ensureKey()).update(message(purpose, material)).digest('hex') },
    verify(purpose: 'measurement' | 'approval', material: unknown, seal: string | undefined) {
      if (!key || !seal || !/^[a-f0-9]{64}$/.test(seal)) return false
      const expected = createHmac('sha256', key).update(message(purpose, material)).digest()
      return timingSafeEqual(expected, Buffer.from(seal, 'hex'))
    },
  }
}
