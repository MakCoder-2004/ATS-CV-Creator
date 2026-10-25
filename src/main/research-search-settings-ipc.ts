import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { ResearchSearchCredentials } from './research-search-credentials'
import { researchSearchKeyInputSchema, researchSearchKeyStatusSchema } from '../shared/research-search-settings'

/** Keep the credential-bearing operation private to main; never register withKey as an IPC method. */
export function registerResearchSearchSettingsIpc(
  ipc: Pick<IpcMain, 'handle'>,
  credentials: Pick<ResearchSearchCredentials, 'status' | 'save' | 'remove'>,
  trusted: (event: IpcMainInvokeEvent) => void
): void {
  ipc.handle('research-search:key:status', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    return researchSearchKeyStatusSchema.parse(await credentials.status())
  })
  ipc.handle('research-search:key:save', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected search key')
    const key = researchSearchKeyInputSchema.safeParse(args[0])
    if (!key.success) throw new Error('Enter a valid search key.')
    try { return researchSearchKeyStatusSchema.parse(await credentials.save(key.data)) }
    catch { throw new Error('Search key could not be saved. Check device encryption and try again.') }
  })
  ipc.handle('research-search:key:remove', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    try { return researchSearchKeyStatusSchema.parse(await credentials.remove()) }
    catch { throw new Error('The local search key could not be removed. Try again.') }
  })
}
