import { promises as fs, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Electron's safeStorage is supplied by the main process, never imported into Node tests. */
export type DeviceEncryption = {
  isEncryptionAvailable(): boolean
}
export type SearchCredentialStatus = { configured: boolean; storageAvailable: boolean; message: string }

const FILE = 'tavily-key.dpapi'
const FOUND = 'Legacy encrypted search key found on this device.'
const ABSENT = 'No legacy encrypted search key is saved on this device.'
const STORED_UNAVAILABLE = 'A legacy encrypted key is stored but device encryption is unavailable. You can still remove it locally.'
const FAILED = 'Legacy search-key storage could not be checked. Any existing key was left unchanged.'

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
        return { configured: Boolean(stat), storageAvailable, message: stat ? storageAvailable ? FOUND : STORED_UNAVAILABLE : ABSENT }
      } catch { return { configured: false, storageAvailable: false, message: FAILED } }
    },
    async remove(): Promise<SearchCredentialStatus> {
      try { await checkLocation(); await fs.unlink(file).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }) }
      catch { throw new Error('The legacy encrypted key could not be removed from this device.') }
      return { configured: false, storageAvailable: available(), message: ABSENT }
    }
  }
}
export type ResearchSearchCredentials = ReturnType<typeof createResearchSearchCredentials>
