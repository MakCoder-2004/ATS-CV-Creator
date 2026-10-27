import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseWuzzufPersonalLocalPolicy } from '../shared/wuzzuf-local-enablement'

const localPolicyDirectory = 'CV Tailor Personal Local Policy'
const localPolicyFile = 'wuzzuf-personal-local.json'
export function wuzzufPersonalLocalPolicyPath(appDataDirectory: string): string {
  return join(appDataDirectory, localPolicyDirectory, localPolicyFile)
}

/** Fails closed unless the owner manually creates a regular appData-side policy file. */
export function isWuzzufPersonalLocalEnabled(appDataDirectory: string): boolean {
  const expectedDirectory = resolve(appDataDirectory, localPolicyDirectory)
  const expectedFile = join(expectedDirectory, localPolicyFile)
  try {
    const appDataReal = realpathSync.native(appDataDirectory)
    const directoryStat = lstatSync(expectedDirectory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || realpathSync.native(expectedDirectory) !== join(appDataReal, localPolicyDirectory)) return false
    const fileStat = lstatSync(expectedFile)
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > 2048 || dirname(realpathSync.native(expectedFile)) !== realpathSync.native(expectedDirectory)) return false
    return parseWuzzufPersonalLocalPolicy(JSON.parse(readFileSync(expectedFile, 'utf8')))
  } catch { return false }
}
