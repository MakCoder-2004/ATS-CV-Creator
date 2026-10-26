import { afterEach, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createResearchSearchCredentials, defaultResearchCredentialDirectory } from '../src/main/research-search-credentials'
import { registerResearchSearchSettingsIpc } from '../src/main/research-search-settings-ipc'
import { createJobResearchSessions } from '../src/main/job-research-session'
import { normalizeJobResearchUrl, type JobResearchRun } from '../src/shared/job-research'
import { buildJobResearchQuery } from '../src/shared/job-research-search-query'
import { JobResearchReview } from '../src/renderer/JobResearchReview'
import { SavedJobs } from '../src/renderer/SavedJobs'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const url = 'https://careers.example.org/jobs/role-4464025097'
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

test('Settings credential IPC and Saved jobs research use the same private key store; rendering and review do not search', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-merged-research-')); roots.push(root)
  const appData = join(root, 'appdata'), workspace = join(root, 'workspace')
  mkdirSync(appData); mkdirSync(workspace)
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (key: string) => Buffer.from(`encrypted:${key}`),
    decryptString: (bytes: Buffer) => bytes.toString().replace(/^encrypted:/, '')
  }
  const credentials = createResearchSearchCredentials({ credentialsDirectory: defaultResearchCredentialDirectory(appData, workspace), workspaceDirectory: workspace, encryption })
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  const trustedEvent = { trusted: true } as unknown as IpcMainInvokeEvent
  registerResearchSearchSettingsIpc({ handle(name, handler) { handlers.set(name, handler as (...args: unknown[]) => Promise<unknown>) } } as Parameters<typeof registerResearchSearchSettingsIpc>[0], credentials,
    (event) => { if (event !== trustedEvent) throw new Error('Untrusted sender') })
  const invoke = (name: string, ...args: unknown[]) => handlers.get(name)!(trustedEvent, ...args)
  await expect(handlers.get('research-search:key:save')!({}, 'tvly-synthetic-example-key-12345')).rejects.toThrow('Untrusted sender')
  expect(await invoke('research-search:key:status')).toMatchObject({ configured: false })
  const saved = await invoke('research-search:key:save', 'tvly-synthetic-example-key-12345')
  expect(saved).toMatchObject({ configured: true })
  expect(JSON.stringify(saved)).not.toContain('tvly-synthetic-example-key-12345')
  const selected = normalizeJobResearchUrl(url)
  const sourceId = randomUUID(), findingId = randomUUID()
  const direct = async (): Promise<JobResearchRun> => ({
    version: 1, id: randomUUID(), selected, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), status: 'provisional',
    sources: [{ version: 1, id: sourceId, url, capturedAt: new Date().toISOString(), method: 'direct-html', identity: 'exact-role', title: 'Synthetic Engineer', employer: 'Example Corp', employerIdentityUrl: null }],
    findings: [{ version: 1, id: findingId, sourceId, kind: 'direct-role-text', text: 'Build synthetic systems.', completeness: 'partial' }], unknowns: ['Complete posting unknown.']
  })
  let searches = 0
  const sessions = createJobResearchSessions({ credentials, direct, createSearch: () => ({ searchesDispatched: 0, search: async () => { searches++; throw new Error('No network in merged smoke') } }) })
  try {
    const html = renderToStaticMarkup(React.createElement(SavedJobs, { jobs: [], activeJob: null, onSaved: () => {}, onOpened: () => {}, onDeleted: async () => {}, onNavigate: () => {} }))
    expect(html).toContain('Import from link')
    const reviewHtml = renderToStaticMarkup(React.createElement(JobResearchReview, { url }))
    expect(reviewHtml).toContain('Nothing is saved or analyzed here.')
    expect(reviewHtml).not.toContain('Analysis complete')
    expect(buildJobResearchQuery(selected)).toBe('job site:careers.example.org')
    const token = sessions.startJobResearch(url).token; await tick()
    const state = sessions.getJobResearch(token)
    expect(state.status).toBe('ready')
    if (state.status !== 'ready') throw new Error('Synthetic direct read did not complete')
    expect(sessions.reviewJobResearch(token, [findingId], true).analysisScope).toBe('provisional')
    expect(searches).toBe(0)
    expect((await sessions.searchJobResearch(token)).status).toBe('unavailable')
    expect(searches).toBe(1)
    expect(await invoke('research-search:key:remove')).toMatchObject({ configured: false })
    expect(await credentials.status()).toMatchObject({ configured: false })
  } finally { sessions.close() }
})
