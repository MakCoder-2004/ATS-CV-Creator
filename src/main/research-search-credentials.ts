import { randomBytes } from 'node:crypto'
import { promises as fs, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Electron's safeStorage is supplied by the main process, never imported into Node tests. */
export type DeviceEncryption = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}
export type SearchCredentialStatus = { configured: boolean; storageAvailable: boolean; message: string }

const FILE = 'tavily-key.dpapi'
const MESSAGE = 'Search is available only after a key is stored on this device.'
const UNAVAILABLE = 'Device encryption is unavailable. No search key was saved.'
const STORED_UNAVAILABLE = 'A search key is stored but device encryption is unavailable; it cannot be used until encryption returns. You can remove it locally.'
const FAILED = 'Search key storage failed. The existing key was not replaced.'

const inside = (target: string, parent: string) => {
  const diff = relative(parent, target)
  return diff === '' || (!diff.startsWith(`..${sep}`) && diff !== '..' && !isAbsolute(diff))
}
/** Resolve an existing ancestor so junctions/symlinks cannot disguise a missing child. */
function physicalPath(path: string): string {
  if (!isAbsolute(path)) throw new Error('A separate absolute private storage path is required.')
  const absolute = resolve(path)
  try { return realpathSync.native(absolute) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = dirname(absolute)
    if (parent === absolute) throw error
    return join(physicalPath(parent), absolute.slice(parent.length).replace(/^[\\/]/, ''))
  }
}
function separate(credentialsDirectory: string, workspaceDirectory: string): void {
  if (inside(credentialsDirectory, workspaceDirectory) || inside(workspaceDirectory, credentialsDirectory))
    throw new Error('Search credentials must be stored outside the workspace and its parent directories.')
}
/** appData and userData must be verified Electron paths; userData contains workspace SQLite. */
export function defaultResearchCredentialDirectory(appDataDirectory: string, userDataDirectory: string): string {
  const directory = physicalPath(join(appDataDirectory, 'CV Tailor Search Credentials'))
  separate(directory, physicalPath(userDataDirectory))
  return directory
}

/** credentialsDirectory must be outside userData, the workspace, and their backups. */
export function createResearchSearchCredentials(options: {
  credentialsDirectory: string
  workspaceDirectory: string
  encryption: DeviceEncryption
}) {
  const { credentialsDirectory, workspaceDirectory, encryption } = options
  const directory = physicalPath(credentialsDirectory)
  const workspace = physicalPath(workspaceDirectory)
  separate(directory, workspace)
  const file = join(directory, FILE)
  const checkLocation = async () => {
    const privateDir = dirname(file)
    // Recheck before every operation: a parent can be replaced by a junction later.
    separate(physicalPath(credentialsDirectory), physicalPath(workspaceDirectory))
    await fs.mkdir(privateDir, { recursive: true, mode: 0o700 })
    const realPrivate = await fs.realpath(privateDir)
    separate(realPrivate, physicalPath(workspaceDirectory))
    const stat = await fs.lstat(file).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    })
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('Invalid private key file.')
  }
  const available = () => { try { return encryption.isEncryptionAvailable() } catch { return false } }
  return {
    async status(): Promise<SearchCredentialStatus> {
      try {
        await checkLocation()
        const stat = await fs.lstat(file).catch(error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        })
        const storageAvailable = available()
        return { configured: Boolean(stat), storageAvailable, message: storageAvailable ? MESSAGE : stat ? STORED_UNAVAILABLE : UNAVAILABLE }
      } catch { return { configured: false, storageAvailable: false, message: FAILED } }
    },
    async save(key: string): Promise<SearchCredentialStatus> {
      if (!available()) throw new Error(UNAVAILABLE)
      if (typeof key !== 'string' || !/^[\x21-\x7e]{12,512}$/.test(key) || /[\s\r\n]/.test(key)) throw new Error('Enter a valid search key.')
      let temp: string | undefined
      try {
        await checkLocation()
        const encrypted = encryption.encryptString(key)
        if (!Buffer.isBuffer(encrypted) || encrypted.length < 1 || encrypted.length > 8192) throw new Error('Invalid encrypted bytes.')
        temp = join(dirname(file), `.tavily-${randomBytes(16).toString('hex')}.tmp`)
        const handle = await fs.open(temp, 'wx', 0o600)
        try { await handle.writeFile(encrypted); await handle.sync() } finally { await handle.close() }
        await fs.rename(temp, file)
        temp = undefined
        return { configured: true, storageAvailable: true, message: MESSAGE }
      } catch { throw new Error(FAILED) }
      finally { if (temp) await fs.unlink(temp).catch(() => {}) }
    },
    async remove(): Promise<SearchCredentialStatus> {
      try { await checkLocation(); await fs.unlink(file).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }) }
      catch { throw new Error('The local search key could not be removed.') }
      return { configured: false, storageAvailable: available(), message: 'The local search key was removed. This does not revoke the provider key.' }
    },
    async withKey<T>(use: (key: string) => Promise<T>): Promise<T> {
      if (!available()) throw new Error(UNAVAILABLE)
      let key: string
      try {
        await checkLocation()
        const ciphertext = await fs.readFile(file)
        if (!ciphertext.length || ciphertext.length > 8192) throw new Error('Invalid ciphertext.')
        key = encryption.decryptString(ciphertext)
        if (!/^[\x21-\x7e]{12,512}$/.test(key)) throw new Error('Invalid key.')
      } catch { throw new Error('The local search key could not be used. Check device encryption or reconnect the key.') }
      return use(key)
    }
  }
}
export type ResearchSearchCredentials = ReturnType<typeof createResearchSearchCredentials>
