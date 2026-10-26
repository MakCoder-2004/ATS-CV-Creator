import { createHash } from 'node:crypto'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { jobRecordSchema, emptyPostingOptionalDetails, type JobRecord } from '../../src/shared/jobs'
import { registerWorkspaceBackupRowSizer } from '../../src/main/workspace-backup'

export function historicalSnapshot(title: string, company: string, description: string, options: { capturedAt?: string; extractionMethod?: 'lever-json-v1' | 'lever-html-jsonld-v1' | 'lever-html-static-v1'; submittedUrl?: string; finalUrl?: string; sourceIdentity?: string } = {}) {
  const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
  return {
    title,
    company,
    description,
    submittedUrl: options.submittedUrl ?? 'https://jobs.lever.co/synthetic-board/historical-role',
    finalUrl: options.finalUrl ?? options.submittedUrl ?? 'https://jobs.lever.co/synthetic-board/historical-role',
    sourceIdentity: options.sourceIdentity ?? 'lever:synthetic-board/historical-role',
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    extractionMethod: options.extractionMethod ?? 'lever-json-v1',
    extractionVersion: 1 as const,
    optionalDetails: emptyPostingOptionalDetails(),
    conflicts: [],
    hashes: { title: hash(title), company: hash(company), description: hash(description) },
    fieldOrigins: { title: 'source' as const, company: 'source' as const, description: 'source' as const, optionalDetails: {} }
  }
}

export function seedHistoricalJob(directory: string, jobId: string, source: { title: string; company: string; description: string; capturedAt?: string; extractionMethod?: 'lever-json-v1' | 'lever-html-jsonld-v1' | 'lever-html-static-v1'; submittedUrl?: string; finalUrl?: string; sourceIdentity?: string }, history: Array<{ title: string; company: string; description: string; capturedAt?: string; extractionMethod?: 'lever-json-v1' | 'lever-html-jsonld-v1' | 'lever-html-static-v1'; submittedUrl?: string; finalUrl?: string; sourceIdentity?: string }> = []): JobRecord {
  const db = new Database(join(directory, 'workbench.sqlite'))
  try {
    registerWorkspaceBackupRowSizer(db)
    const row = db.prepare('SELECT data FROM jobs WHERE id = ?').get(jobId) as { data: string } | undefined
    if (!row) throw new Error(`Saved job ${jobId} was not found in the isolated fixture.`)
    const current = jobRecordSchema.parse(JSON.parse(row.data))
    const record = jobRecordSchema.parse({
      ...current,
      provenance: 'imported',
      sourceSnapshot: historicalSnapshot(source.title, source.company, source.description, source),
      sourceHistory: history.map(item => historicalSnapshot(item.title, item.company, item.description, item)),
      revisions: current.revisions.map(revision => ({ ...revision, provenance: 'imported' }))
    })
    db.prepare('UPDATE jobs SET data = ? WHERE id = ?').run(JSON.stringify(record), jobId)
    const stored = jobRecordSchema.parse(JSON.parse((db.prepare('SELECT data FROM jobs WHERE id = ?').get(jobId) as { data: string }).data))
    if (stored.revisions.some((revision, index) => revision.revision !== index + 1)) throw new Error('Historical posting revisions must be contiguous and one-based.')
    const latest = stored.revisions.at(-1)
    if (!latest || latest.title !== stored.title || latest.company !== stored.company || latest.description !== stored.description) throw new Error('Latest posting revision must match the saved working wording.')
    for (const snapshot of [...stored.sourceHistory, stored.sourceSnapshot!]) {
      const companyHash = snapshot.company === null ? null : createHash('sha256').update(snapshot.company, 'utf8').digest('hex')
      if (snapshot.hashes.title !== createHash('sha256').update(snapshot.title, 'utf8').digest('hex') || snapshot.hashes.description !== createHash('sha256').update(snapshot.description, 'utf8').digest('hex') || snapshot.hashes.company !== companyHash) throw new Error('Historical snapshot hashes do not match its source wording.')
    }
    return stored
  } finally { db.close() }
}
