import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { ResearchSearchCredentials } from './research-search-credentials'
import { researchSearchKeyCopySchema, researchSearchKeyRevealSchema, researchSearchKeyStatusSchema } from '../shared/research-search-settings'

/** Keep the credential-bearing operation private to main; never register withKey as an IPC method. */
export function registerResearchSearchSettingsIpc(
  ipc: Pick<IpcMain, 'handle'>,
  credentials: Pick<ResearchSearchCredentials, 'status' | 'remove' | 'withKey'>,
  trusted: (event: IpcMainInvokeEvent) => void,
  clipboard?: { writeText(text: string): void }
): void {
  ipc.handle('research-search:key:status', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    return researchSearchKeyStatusSchema.parse(await credentials.status())
  })
  // No arguments may supply a key or trigger decryption implicitly. `trusted` verifies
  // the sender is this window's main frame before any access to the device store.
  ipc.handle('research-search:key:reveal', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    try { return await credentials.withKey(async key => researchSearchKeyRevealSchema.parse({ key })) }
    catch { throw new Error('The local search key could not be revealed. Check device encryption or reconnect the key.') }
  })
  ipc.handle('research-search:key:copy', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    if (!clipboard) throw new Error('Clipboard access is unavailable. The search key was not copied.')
    try {
      await credentials.withKey(async key => { clipboard.writeText(key) })
      return researchSearchKeyCopySchema.parse({ ok: true, message: 'Search key copied. Clipboard contents remain outside CV Tailor until replaced.' })
    } catch { throw new Error('The local search key could not be copied. Check device encryption or reconnect the key.') }
  })
  ipc.handle('research-search:key:remove', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    try { return researchSearchKeyStatusSchema.parse(await credentials.remove()) }
    catch { throw new Error('The local search key could not be removed. Try again.') }
  })
}
