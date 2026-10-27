import { afterEach, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createResearchSearchCredentials, defaultResearchCredentialDirectory, type DeviceEncryption } from '../src/main/research-search-credentials'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'search-credentials-'))
  directories.push(directory)
  const encryption: DeviceEncryption = { isEncryptionAvailable: () => true }
  const appDataDirectory = join(directory, 'app-data'), userDataDirectory = join(appDataDirectory, 'CV Tailor'), workspaceDirectory = userDataDirectory
  await mkdir(userDataDirectory, { recursive: true })
  const credentialsDirectory = defaultResearchCredentialDirectory(appDataDirectory, userDataDirectory)
  const file = join(credentialsDirectory, 'tavily-key.dpapi')
  const store = createResearchSearchCredentials({ encryption, credentialsDirectory, workspaceDirectory })
  return { directory, appDataDirectory, credentialsDirectory, userDataDirectory, workspaceDirectory, file, store }
}

test('reports absent legacy key and preserves encrypted bytes until explicit removal', async () => {
  const { store, file, credentialsDirectory, workspaceDirectory } = await fixture()
  expect(await store.status()).toMatchObject({ configured: false, storageAvailable: true, message: 'No legacy encrypted search key is saved on this device.' })
  const syntheticCiphertext = Buffer.from('synthetic-encrypted-fixture-only')
  await mkdir(credentialsDirectory, { recursive: true })
  await writeFile(file, syntheticCiphertext)
  expect(await store.status()).toMatchObject({ configured: true, storageAvailable: true, message: 'Legacy encrypted search key found on this device.' })
  expect(await readFile(file)).toEqual(syntheticCiphertext)
  expect(await readdir(workspaceDirectory)).toEqual([])
  expect(await store.remove()).toMatchObject({ configured: false, message: 'No legacy encrypted search key is saved on this device.' })
  expect(await readFile(file).catch(() => null)).toBeNull()
})

test('reports an unreadable legacy location without claiming absence', async () => {
  const f = await fixture()
  await mkdir(f.credentialsDirectory, { recursive: true })
  await writeFile(f.file, Buffer.from('synthetic-encrypted-fixture-only'))
  await rm(f.credentialsDirectory, { recursive: true })
  await symlink(f.workspaceDirectory, f.credentialsDirectory, 'junction')
  expect(await f.store.status()).toMatchObject({ configured: false, storageAvailable: false, message: 'Legacy search-key storage could not be checked. Any existing key was left unchanged.' })
})

test('rejects storage below workspace, including an alias to it', async () => {
  const f = await fixture()
  expect(() => createResearchSearchCredentials({ encryption: { isEncryptionAvailable: () => true }, credentialsDirectory: join(f.workspaceDirectory, 'private'), workspaceDirectory: f.workspaceDirectory })).toThrow(/outside/)
  expect(() => createResearchSearchCredentials({ encryption: { isEncryptionAvailable: () => true }, credentialsDirectory: f.workspaceDirectory, workspaceDirectory: f.workspaceDirectory })).toThrow(/outside/)
  const alias = join(f.directory, 'credentials-alias')
  await symlink(f.workspaceDirectory, alias, 'junction')
  expect(() => createResearchSearchCredentials({ encryption: { isEncryptionAvailable: () => true }, credentialsDirectory: alias, workspaceDirectory: f.workspaceDirectory })).toThrow(/outside/)
  expect(await readdir(f.workspaceDirectory)).toEqual([])
  expect(() => createResearchSearchCredentials({ encryption: { isEncryptionAvailable: () => true }, credentialsDirectory: f.directory, workspaceDirectory: f.workspaceDirectory })).toThrow(/outside/)
  expect(() => defaultResearchCredentialDirectory(f.userDataDirectory, f.userDataDirectory)).toThrow(/outside/)
  const userAlias = join(f.directory, 'workspace-alias')
  await symlink(f.userDataDirectory, userAlias, 'junction')
  expect(() => defaultResearchCredentialDirectory(f.appDataDirectory, userAlias)).not.toThrow()
  expect(() => defaultResearchCredentialDirectory(f.userDataDirectory, userAlias)).toThrow(/outside/)
})
