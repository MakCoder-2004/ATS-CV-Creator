import { z } from 'zod'

export const WORKSPACE_BACKUP_VERSION = 3 as const
export const workspaceBackupWarning = 'This file contains personal profile and accepted CV source passages, job, draft, evidence, review, consent, checkpoint, usage, and settings data. Store it securely; it excludes encrypted credentials and API keys.'

export const workspaceBackupSchema = z.object({
  format: z.literal('cv-tailor-workspace-backup'),
  version: z.union([z.literal(1), z.literal(2), z.literal(WORKSPACE_BACKUP_VERSION)]),
  createdAt: z.string().datetime(),
  warning: z.literal(workspaceBackupWarning),
  tables: z.record(z.string(), z.object({
    schema: z.string(),
    rows: z.array(z.record(z.string(), z.unknown()))
  }).strict())
}).strict()
export type WorkspaceBackup = z.infer<typeof workspaceBackupSchema>
export type WorkspaceRestorePreview = {
  token: string
  warning: string
  replaceTables: string[]
  rowCounts: Record<string, { current: number; restored: number }>
  credentialsRemoved: boolean
  consentInvalidated: true
  automaticRunsResumed: false
}

export interface WorkspaceBackupEngine {
  createBackup(): string
  previewRestore(input: string): WorkspaceRestorePreview
  applyRestore(token: string, writeAndVerifySafetyBackup: (backup: string) => string): void
  cancelRestore(token: string): boolean
}
