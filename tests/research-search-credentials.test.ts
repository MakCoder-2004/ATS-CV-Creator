import { afterEach, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createResearchSearchCredentials, type DeviceEncryption } from '../src/main/research-search-credentials'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'search-credentials-'))
  directories.push(directory)
  const encryption: DeviceEncryption = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value.split('').reverse().join(''), 'utf8'),
    decryptString: value => value.toString('utf8').split('').reverse().join('')
  }
  const userDataDirectory = join(directory, 'user-data'), workspaceDirectory = join(directory, 'workspace')
  return { directory, encryption, userDataDirectory, workspaceDirectory, store: createResearchSearchCredentials({ encryption, userDataDirectory, workspaceDirectory }) }
}

test('stores only encrypted bytes outside the workspace and exposes only safe status', async () => {
  const { store, userDataDirectory, workspaceDirectory } = await fixture()
  const key = 'tvly-SAMPLE-SECRET-12345'
  expect(await store.status()).toMatchObject({ configured: false, storageAvailable: true })
  expect(await store.save(key)).toMatchObject({ configured: true, storageAvailable: true })
  const file = join(userDataDirectory, 'private-auth', 'tavily-key.dpapi')
  expect((await readFile(file)).toString()).not.toContain(key)
  expect(await readdir(workspaceDirectory).catch(() => [])).toEqual([])
  let keySeen = false
  await store.withKey(async value => { keySeen = value === key })
  expect(keySeen).toBe(true)
  expect(JSON.stringify(await store.status())).not.toContain(key)
  expect(await store.remove()).toMatchObject({ configured: false })
  expect(await store.status()).toMatchObject({ configured: false })
})

test('unavailable encryption and failed encryption never write plaintext or replace a previous key', async () => {
  const f = await fixture()
  await f.store.save('tvly-PREVIOUS-KEY')
  const file = join(f.userDataDirectory, 'private-auth', 'tavily-key.dpapi')
  const before = await readFile(file)
  const broken = createResearchSearchCredentials({ ...f, encryption: { ...f.encryption, encryptString: () => { throw new Error('tvly-UNSAFE-DIAGNOSTIC') } } })
  await expect(broken.save('tvly-NEXT-SECRET')).rejects.toThrow(/storage failed/)
  expect(await readFile(file)).toEqual(before)
  const offline = createResearchSearchCredentials({ ...f, encryption: { ...f.encryption, isEncryptionAvailable: () => false } })
  expect(await offline.status()).toMatchObject({ configured: false, storageAvailable: false })
  await expect(offline.save('tvly-NEW-SECRET')).rejects.toThrow(/unavailable/)
  await expect(offline.withKey(async () => undefined)).rejects.toThrow(/unavailable/)
  expect(await readFile(file)).toEqual(before)
})

test('rejects storage below workspace, including an alias to it', async () => {
  const f = await fixture()
  expect(() => createResearchSearchCredentials({ encryption: f.encryption, userDataDirectory: join(f.workspaceDirectory, 'private'), workspaceDirectory: f.workspaceDirectory })).toThrow(/outside/)
  expect(() => createResearchSearchCredentials({ encryption: f.encryption, userDataDirectory: f.workspaceDirectory, workspaceDirectory: f.workspaceDirectory })).toThrow(/outside/)
  await mkdir(f.workspaceDirectory)
  const alias = join(f.directory, 'user-alias')
  await symlink(f.workspaceDirectory, alias, 'junction')
  const store = createResearchSearchCredentials({ encryption: f.encryption, userDataDirectory: alias, workspaceDirectory: f.workspaceDirectory })
  await expect(store.save('tvly-SAMPLE-KEY')).rejects.toThrow(/storage failed/)
  expect(await readdir(f.workspaceDirectory)).toEqual([])
})
