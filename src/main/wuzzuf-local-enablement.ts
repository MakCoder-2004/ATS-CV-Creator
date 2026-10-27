import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseWuzzufPersonalLocalPolicy, wuzzufPersonalLocalPolicySchema } from '../shared/wuzzuf-local-enablement'

const localPolicyDirectory = 'CV Tailor Personal Local Policy'
const localPolicyFile = 'wuzzuf-personal-local.json'
export function wuzzufPersonalLocalPolicyPath(appDataDirectory: string): string {
  return join(appDataDirectory, localPolicyDirectory, localPolicyFile)
}
/** Stable, non-secret binding to the installation's canonical physical location. */
export function wuzzufInstallationFingerprint(installationRoot: string): string {
  const physical = realpathSync.native(installationRoot)
  const normalized = process.platform === 'win32' ? physical.toLocaleLowerCase('en-US') : physical
  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}

/** Fails closed unless the owner-created appData policy is bound to this physical app location. */
export function isWuzzufPersonalLocalEnabled(appDataDirectory: string, installationRoot: string): boolean {
  const expectedDirectory = join(appDataDirectory, localPolicyDirectory)
  const expectedFile = join(expectedDirectory, localPolicyFile)
  try {
    const directoryStat = lstatSync(expectedDirectory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return false
    const directoryPhysical = realpathSync.native(expectedDirectory)
    const expectedPhysicalDirectory = join(realpathSync.native(appDataDirectory), localPolicyDirectory)
    if (comparablePath(directoryPhysical) !== comparablePath(expectedPhysicalDirectory)) return false
    const fileStat = lstatSync(expectedFile)
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > 2048 || comparablePath(dirname(realpathSync.native(expectedFile))) !== comparablePath(directoryPhysical)) return false
    const parsed = JSON.parse(readFileSync(expectedFile, 'utf8'))
    if (!parseWuzzufPersonalLocalPolicy(parsed)) return false
    const policy = wuzzufPersonalLocalPolicySchema.parse(parsed)
    return policy.installationFingerprint === wuzzufInstallationFingerprint(installationRoot)
  } catch { return false }
}
function comparablePath(path: string): string {
  const physical = realpathSync.native(path)
  return process.platform === 'win32' ? physical.toLocaleLowerCase('en-US') : physical
}
