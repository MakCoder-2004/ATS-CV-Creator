import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { closeSync, lstatSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Local receipts are not backup/renderer authority. The key never leaves main's userData. */
export function createCoverLetterAuthority(userData: string) {
  const path = join(userData, 'cover-letter-local-authority.key')
  let key: Buffer | undefined
  function load() {
    const info = lstatSync(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size !== 32) throw new Error('Local letter authority is unavailable.')
    return readFileSync(path)
  }
  try { key = load() } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  function ensureKey() {
    if (key) return key
    const candidate = randomBytes(32)
    let fd: number | undefined
    try { fd = openSync(path, 'wx', 0o600); writeFileSync(fd, candidate); key = candidate }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; key = load() }
    finally { if (fd !== undefined) closeSync(fd) }
    return key
  }
  const message = (purpose: 'measurement' | 'approval', material: unknown) => JSON.stringify({ version: 1, purpose, material })
  return {
    seal(purpose: 'measurement' | 'approval', material: unknown) { return createHmac('sha256', ensureKey()).update(message(purpose, material)).digest('hex') },
    verify(purpose: 'measurement' | 'approval', material: unknown, seal: string | undefined) {
      if (!key || !seal || !/^[a-f0-9]{64}$/.test(seal)) return false
      const expected = createHmac('sha256', key).update(message(purpose, material)).digest()
      return timingSafeEqual(expected, Buffer.from(seal, 'hex'))
    },
  }
}
