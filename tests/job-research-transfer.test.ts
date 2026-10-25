import { afterEach, expect, test } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import { createJobResearchSessions } from '../src/main/job-research-session'
import { fetchDirectJobResearch } from '../src/main/job-research-fetch'

const url = 'https://www.linkedin.com/jobs/view/4464025097/'
const folders: string[] = []
afterEach(async () => { for (const path of folders.splice(0)) await rm(path, { recursive: true, force: true }) })
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'cv-research-transfer-')); folders.push(folder)
  let calls = 0
  const transport = {
    lookup: async () => [{ address: '8.8.8.8', family: 4 as const }],
    request: async (destination: URL) => { expect([url, 'https://careers.fictional.org/jobs/role-4']).toContain(destination.href); calls++; return { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html>synthetic role</html>') } },
    extract: async () => ({ outcome: 'partial' as const, title: 'Synthetic Engineer', employer: 'Invented Corp', description: 'Original direct partial requirement.', reason: 'Description truncated.' }),
  }
  const wb = createWorkbench(folder, undefined, undefined, undefined, { research: transport })
  const sessions = createJobResearchSessions({
    credentials: { status: async () => ({ configured: true, storageAvailable: true, message: '' }), withKey: async <T>(fn: (key: string) => Promise<T>) => fn('synthetic') },
    direct: (selected, options) => fetchDirectJobResearch(selected, { ...transport, ...options }),
    createSearch: () => ({ searchesDispatched: 0, search: async () => ({ links: [{ url, title: 'Synthetic Engineer — Invented Corp', snippet: 'Indexed partial requirement.' }], credits: 1, requestId: 'synthetic' }) }),
  })
  return { wb, sessions, get calls() { return calls } }
}
async function notice(wb: ReturnType<typeof createWorkbench>, token: string) {
  for (let i = 0; i < 100; i++) {
    const state = await wb.api.readPostingPreview(token)
    if (state.status !== 'fetching') return state
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw Error('Posting fetch did not settle')
}
test('first partial read transfers its complete app-held evidence without a second direct GET; exact indexed match alone permits a verification reread', async () => {
  const t = fixture()
  try {
    const original = (await t.wb.api.startPostingFetch(url)).token
    expect(await notice(t.wb, original)).toMatchObject({ status: 'research-notice', message: expect.stringContaining('Description truncated.') })
    expect(t.calls).toBe(1)
    const captured = t.wb.api.takePostingResearchRun(original)
    expect(captured).toMatchObject({ status: 'provisional', findings: [{ text: 'Original direct partial requirement.' }], unknowns: ['Description truncated.'] })
    expect(() => t.wb.api.takePostingResearchRun(original)).toThrow(/unavailable/)
    const token = t.sessions.acceptInitialDirectRun(captured).token
    expect(t.calls).toBe(1)
    const state = t.sessions.getJobResearch(token)
    expect(state).toMatchObject({ status: 'ready', run: { id: captured.id, findings: [{ id: captured.findings[0].id }] } })
    const searched = await t.sessions.searchJobResearch(token)
    expect(t.calls).toBe(2)
    expect(searched.status).toBe('ready')
    if (searched.status === 'ready') {
      expect(searched.run.findings).toEqual(expect.arrayContaining([expect.objectContaining({ id: captured.findings[0].id, text: 'Original direct partial requirement.' }), expect.objectContaining({ kind: 'indexed-role-claim', text: 'Indexed partial requirement.' })]))
      expect(searched.run.unknowns).toContain('Description truncated.')
    }
  } finally { t.sessions.close(); t.wb.close() }
})
test('no exact indexed match leaves first direct findings visible and does not reread', async () => {
  const t = fixture()
  try {
    const posting = (await t.wb.api.startPostingFetch(url)).token
    await notice(t.wb, posting)
    const original = t.wb.api.takePostingResearchRun(posting)
    const noMatch = createJobResearchSessions({
      credentials: { status: async () => ({ configured: true, storageAvailable: true, message: '' }), withKey: async <T>(fn: (key: string) => Promise<T>) => fn('synthetic') },
      direct: async () => { throw Error('No direct reread permitted for a mismatched candidate') },
      createSearch: () => ({ searchesDispatched: 0, search: async () => ({ links: [{ url: 'https://careers.fictional.org/jobs/different', title: 'Synthetic Engineer — Invented Corp', snippet: 'Unrelated claim.' }], credits: 1, requestId: 'synthetic' }) }),
    })
    try {
      const token = noMatch.acceptInitialDirectRun(original).token
      expect(t.calls).toBe(1)
      const searched = await noMatch.searchJobResearch(token)
      expect(t.calls).toBe(1)
      expect(searched).toMatchObject({ status: 'ready', run: { findings: [{ id: original.findings[0].id, text: original.findings[0].text }] } })
      if (searched.status === 'ready') expect(searched.run.unknowns).toContain('Description truncated.')
    } finally { noMatch.close() }
  } finally { t.sessions.close(); t.wb.close() }
})
test('cancel, replacement source and invalid token cannot transfer stale evidence', async () => {
  const t = fixture()
  try {
    const cancelled = (await t.wb.api.startPostingFetch(url)).token
    await notice(t.wb, cancelled)
    expect(await t.wb.api.cancelPostingFetch(cancelled)).toEqual({ ok: true })
    expect(() => t.wb.api.takePostingResearchRun(cancelled)).toThrow(/unavailable/)
    const prior = (await t.wb.api.startPostingFetch(url)).token
    await notice(t.wb, prior)
    const replacement = (await t.wb.api.startPostingFetch('https://careers.fictional.org/jobs/role-4')).token
    expect(() => t.wb.api.takePostingResearchRun(prior)).toThrow(/unavailable/)
    expect(() => t.wb.api.takePostingResearchRun('not-a-uuid')).toThrow(/unavailable/)
    await notice(t.wb, replacement)
    expect(t.calls).toBe(3)
  } finally { t.sessions.close(); t.wb.close() }
})
test('failed direct transport has no transferable result', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'cv-failed-transfer-')); folders.push(folder)
  const wb = createWorkbench(folder, undefined, undefined, undefined, { research: {
    lookup: async () => { throw Error('Synthetic network failure') },
  } })
  try {
    const token = (await wb.api.startPostingFetch(url)).token
    expect(await notice(wb, token)).toMatchObject({ status: 'failed' })
    expect(() => wb.api.takePostingResearchRun(token)).toThrow(/unavailable/)
  } finally { wb.close() }
})
