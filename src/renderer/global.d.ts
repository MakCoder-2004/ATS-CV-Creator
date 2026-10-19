import type { WorkbenchAPI } from '../shared/appearance'

declare global {
  interface Window {
    workbench: WorkbenchAPI
  }
}
