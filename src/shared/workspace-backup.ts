import { z } from 'zod'
import { MAX_POSTING_REVISIONS } from './jobs'

export const WORKSPACE_BACKUP_VERSION = 2 as const
export const MAX_WORKSPACE_BACKUP_BYTES = 64 * 1024 * 1024
export const MAX_WORKSPACE_BACKUP_ROW_BYTES = 16 * 1024 * 1024
// Retain pre-limit histories from earlier workspace files; never set this below the accepted-write ceiling.
export const MAX_WORKSPACE_BACKUP_POSTING_REVISIONS = Math.max(100_000, MAX_POSTING_REVISIONS)
export const WORKSPACE_BACKUP_TABLE_ROW_LIMITS: Readonly<Record<string, number>> = {
  schema_migrations: 100, settings: 100, profile_contact: 1, profile_skills: 10_000, profile_entries: 10_000,
  evidence_revisions: 50_000, profile_import_provenance: 50_000, profile_experience: 10_000, profile_projects: 10_000,
  jobs: 5_000, outbound_consents: 50_000, posting_analysis_cache: 5_000, analysis_run_state: 5_000,
  analysis_attempts: 100_000, provider_attempt_outcomes: 100_000, generation_recovery: 5_000,
  generation_recovery_extensions: 50_000, draft_revisions: 10_000, regeneration_proposals: 10_000,
  document_fit_reports: 10_000, langgraph_checkpoints: 50_000, langgraph_checkpoint_writes: 100_000
}
export const workspaceBackupWarning = 'This file contains personal profile and accepted CV source passages, job, draft, evidence, review, consent, checkpoint, usage, and settings data. Store it securely; it excludes encrypted credentials and API keys.'

export const workspaceBackupSchema = z.object({
  format: z.literal('cv-tailor-workspace-backup'),
  version: z.union([z.literal(1), z.literal(WORKSPACE_BACKUP_VERSION)]),
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
  assertBackupCapacity(): void
  previewRestore(input: string): WorkspaceRestorePreview
  applyRestore(token: string, writeAndVerifySafetyBackup: (backup: string) => string): void
  cancelRestore(token: string): boolean
}
