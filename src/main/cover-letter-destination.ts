import { closeSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { constants } from 'node:fs'
import type { BigIntStats } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto'

const MAX_BYTES = 20 * 1024 * 1024
const handles = new WeakMap<object, Capture>()

type Fingerprint = { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint; digest: Buffer }
type Capture = { path: string; fingerprint: Fingerprint | null; used: boolean }

export interface LetterDestinationCapture {
  readonly exists: boolean
  readonly [captureBrand]: true
}
declare const captureBrand: unique symbol

export class LetterDestinationError extends Error {
  constructor(readonly code: 'INVALID_PATH' | 'DESTINATION_UNAVAILABLE' | 'OVERWRITE_REQUIRED' | 'DESTINATION_CHANGED' | 'INVALID_CAPTURE' | 'INVALID_BYTES' | 'GUARD_FAILED' | 'COMMIT_FAILED') {
    super(`Letter destination operation failed: ${code}`)
    this.name = 'LetterDestinationError'
  }
}

function fail(code: ConstructorParameters<typeof LetterDestinationError>[0]): never { throw new LetterDestinationError(code) }
function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT' }
function statsFingerprint(stats: BigIntStats, digest: Buffer): Fingerprint {
  return { dev: stats.dev, ino: stats.ino, size: stats.size, mtimeNs: stats.mtimeNs, ctimeNs: stats.ctimeNs, digest }
}
function sameMetadata(a: Fingerprint, b: Fingerprint): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs
}

function readFingerprint(path: string): Fingerprint | null {
  let fd: number | undefined
  let inspectedPath = false
  try {
    const beforePath = lstatSync(path, { bigint: true })
    inspectedPath = true
    if (!beforePath.isFile() || beforePath.isSymbolicLink() || beforePath.size > BigInt(MAX_BYTES)) fail('DESTINATION_UNAVAILABLE')
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const before = fstatSync(fd, { bigint: true })
    if (!before.isFile() || before.dev !== beforePath.dev || before.ino !== beforePath.ino || before.size > BigInt(MAX_BYTES)) fail('DESTINATION_CHANGED')
    const content = Buffer.alloc(Number(before.size) + 1)
    let offset = 0
    while (offset < content.length) {
      const count = readSync(fd, content, offset, content.length - offset, offset)
      if (count === 0) break
      offset += count
    }
    if (offset > MAX_BYTES || BigInt(offset) !== before.size) fail('DESTINATION_CHANGED')
    const after = fstatSync(fd, { bigint: true })
    const afterPath = lstatSync(path, { bigint: true })
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || afterPath.dev !== after.dev || afterPath.ino !== after.ino || !afterPath.isFile()) fail('DESTINATION_CHANGED')
    return statsFingerprint(after, createHash('sha256').update(content.subarray(0, offset)).digest())
  } catch (error) {
    if (isMissing(error) && !inspectedPath) return null
    if (isMissing(error)) fail('DESTINATION_CHANGED')
    if (error instanceof LetterDestinationError) throw error
    fail('DESTINATION_UNAVAILABLE')
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
  return null
}

export function captureLetterDestination(absolutePath: string): LetterDestinationCapture {
  if (typeof absolutePath !== 'string' || !isAbsolute(absolutePath)) fail('INVALID_PATH')
  const fingerprint = readFingerprint(absolutePath)
  const handle = Object.freeze({ exists: fingerprint !== null }) as LetterDestinationCapture
  handles.set(handle, { path: absolutePath, fingerprint, used: false })
  return handle
}

function compareCapture(capture: Capture): void {
  const current = readFingerprint(capture.path)
  if (capture.fingerprint === null) {
    if (current !== null) fail('DESTINATION_CHANGED')
    return
  }
  if (current === null || !sameMetadata(capture.fingerprint, current) || !timingSafeEqual(capture.fingerprint.digest, current.digest)) fail('DESTINATION_CHANGED')
}

function validateGuard(guard: () => undefined): void {
  try {
    const result: unknown = guard()
    if (result !== undefined) {
      if (result && (typeof result === 'object' || typeof result === 'function') && typeof (result as { then?: unknown }).then === 'function') {
        // Avoid an unhandled rejection if an async assertion rejects after this synchronous API returns.
        Promise.resolve(result).catch(() => undefined)
      }
      fail('GUARD_FAILED')
    }
  } catch (error) {
    if (error instanceof LetterDestinationError) throw error
    fail('GUARD_FAILED')
  }
}

export function commitLetterDestination(
  handle: LetterDestinationCapture,
  bytes: Uint8Array,
  options: { overwriteApproved: boolean; beforeCommit: () => undefined },
): void {
  const capture = (handle && typeof handle === 'object' ? handles.get(handle) : undefined)
  if (!capture || capture.used) fail('INVALID_CAPTURE')
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) fail('INVALID_BYTES')
  if (!options || typeof options.overwriteApproved !== 'boolean' || typeof options.beforeCommit !== 'function') fail('GUARD_FAILED')
  if (capture.fingerprint !== null && options.overwriteApproved !== true) fail('OVERWRITE_REQUIRED')
  const payload = Buffer.from(bytes)
  capture.used = true

  let temporary: string | undefined
  let fd: number | undefined
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = join(dirname(capture.path), `.letter-${randomBytes(16).toString('hex')}.tmp`)
      try {
        fd = openSync(candidate, 'wx', 0o600)
        temporary = candidate
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    if (fd === undefined || temporary === undefined) fail('COMMIT_FAILED')
    let offset = 0
    while (offset < payload.length) offset += writeSync(fd, payload, offset, payload.length - offset)
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined

    validateGuard(options.beforeCommit)
    compareCapture(capture)
    if (capture.fingerprint !== null) renameSync(temporary, capture.path)
    else {
      linkSync(temporary, capture.path)
      unlinkSync(temporary)
    }
    temporary = undefined
  } catch (error) {
    if (error instanceof LetterDestinationError) throw error
    fail('COMMIT_FAILED')
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd) } catch { /* preserve primary result */ }
    }
    if (temporary !== undefined) {
      try { unlinkSync(temporary) } catch { /* only remove the temp created by this operation */ }
    }
  }
}
