import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { ResearchSearchCredentials } from './research-search-credentials'
import { researchSearchKeyStatusSchema } from '../shared/research-search-settings'

/** Only status inspection and explicit local removal remain; no credential can leave main. */
export function registerResearchSearchSettingsIpc(
  ipc: Pick<IpcMain, 'handle'>,
  credentials: Pick<ResearchSearchCredentials, 'status' | 'remove'>,
  trusted: (event: IpcMainInvokeEvent) => void
): void {
  ipc.handle('research-search:key:status', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    return researchSearchKeyStatusSchema.parse(await credentials.status())
  })
  ipc.handle('research-search:key:remove', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    try { return researchSearchKeyStatusSchema.parse(await credentials.remove()) }
    catch { throw new Error('The old encrypted key could not be removed from this device. It was left unchanged.') }
  })
}
