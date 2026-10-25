import { afterEach, expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { registerWorkspaceBackupRowSizer } from '../src/main/workspace-backup'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'

const dirs: string[] = [], opened: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const wb of opened.splice(0)) wb.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5 }) })

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'paragraph-regenerate-')); dirs.push(dir)
  let proposed = 'Improved delivery.'
  const transport: AnalysisTransport = { async generate({ prompt }) {
    if (prompt.startsWith('Extract only explicit qualifications')) return JSON.stringify({ required: [], preferred: [], tools: [], responsibilities: [], keywords: [] })
    if (prompt.startsWith('Score these numbered')) {
      const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Source.' })) })
    }
    if (prompt.startsWith('Propose conservative replacement wording')) {
      const { sourcesByItem } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ items: sourcesByItem.map(() => ({ text: proposed, rationale: 'Same cited record.' })) })
    }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const items = (category: string, text: string) => selected.filter((item: { category: string }) => item.category === category).map((item: { index: number }) => ({ text, evidence: [item.index], rationale: 'Source.' }))
    return JSON.stringify({ headline: 'Engineer', summary: { text: 'Engineer.', evidence: [selected[0].index], rationale: 'Source.' }, education: [], experience: items('experience', 'Built reliable services.'), projects: items('projects', 'Built monitoring dashboard.'), skills: [], certificates: [] })
  } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  const role = await wb.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Example', description: 'Built reliable services and improved delivery.' })
  const project = await wb.api.saveProject({ name: 'Monitoring', description: 'Built monitoring dashboard and documented evaluation.' })
  const job = await wb.api.saveJob({ title: 'Engineer', company: 'Target', description: 'Build reliable monitoring.' })
  if (!role.ok || !project.ok || !job.ok) throw Error('Fixture failed')
  const authorize = async () => { const preview = await wb.api.prepareOutboundConsent(job.value.id); if (!preview.ok) throw Error(preview.message); expect((await wb.api.acceptOutboundConsent(preview.token, true, true)).ok).toBe(true); return preview.token }
  const token = await authorize()
  expect((await wb.api.startAnalysis(token)).status).toBe('complete')
  expect((await wb.api.generateDraft(token)).ok).toBe(true)
  const canonical = await wb.api.getCanonicalDocument(job.value.id)
  if (!canonical) throw Error('Canonical document missing')
  expect(await wb.api.saveDocumentFitReport(job.value.id, { documentHash: createHash('sha256').update(JSON.stringify(canonical)).digest('hex'), targetPages: 1, actualPages: 1, extractedText: ['Built reliable services.', 'Built monitoring dashboard.'], linkTargets: [], links: [], overflow: false, proposedCuts: [], measuredAt: new Date().toISOString() })).toBeTruthy()
  expect(await wb.api.approveDraft(job.value.id)).toMatchObject({ ok: true })
  return { wb, dir, transport, jobId: job.value.id, authorize, setProposed: (value: string) => { proposed = value } }
}

test.each(['experience', 'projects'] as const)('%s regeneration rejects malformed output, retains rejected wording, and invalidates accepted review and approval', async section => {
  const { wb, jobId, authorize, setProposed } = await fixture()
  const initial = await wb.api.getDraft(jobId)
  expect(initial?.approved).toBe(true)
  const before = initial!.content[section][0].text
  const sibling = section === 'experience' ? 'projects' : 'experience'
  const other = initial!.content[sibling][0].text
  for (const invalid of [Array(61).fill('Built').join(' '), 'Built one line.\nBuilt another.']) {
    setProposed(invalid)
    expect(await wb.api.regenerateDraft(await authorize(), { kind: 'paragraph', section, index: 0 })).toMatchObject({ ok: false })
    expect(await wb.api.getDraft(jobId)).toMatchObject({ id: initial!.id, revision: initial!.revision, approved: true, content: initial!.content })
    expect(await wb.api.getRegenerationProposal(jobId)).toBeNull()
    expect(await wb.api.assertDraftExportable(jobId)).toMatchObject({ ok: true })
  }
  setProposed(section === 'experience' ? 'Improved delivery.' : 'Documented evaluation.')
  const rejected = await wb.api.regenerateDraft(await authorize(), { kind: 'paragraph', section, index: 0 })
  expect(rejected).toMatchObject({ ok: true, proposal: { status: 'pending', target: { section, index: 0 } } })
  expect(await wb.api.getDraft(jobId)).toMatchObject({ id: initial!.id, revision: initial!.revision, approved: true, content: initial!.content })
  expect(await wb.api.resolveRegenerationProposal(jobId, rejected.proposal!.id, 'reject')).toMatchObject({ ok: true })
  expect(await wb.api.getDraft(jobId)).toMatchObject({ id: initial!.id, revision: initial!.revision, approved: true, content: initial!.content })
  const accepted = await wb.api.regenerateDraft(await authorize(), { kind: 'paragraph', section, index: 0 })
  expect(accepted.ok).toBe(true)
  expect(await wb.api.resolveRegenerationProposal(jobId, accepted.proposal!.id, 'accept')).toMatchObject({ draft: { approved: false, approval: undefined, status: 'unverified' } })
  const current = await wb.api.getDraft(jobId)
  expect(current?.content[section][0]).toMatchObject({ text: section === 'experience' ? 'Improved delivery.' : 'Documented evaluation.', descriptionFormat: 'paragraph' })
  expect(current?.content[sibling][0].text).toBe(other)
  expect(current?.content[section][0].text).not.toBe(before)
  expect(current?.revision).toBe(initial!.revision + 1)
  expect(current?.approved).toBe(false)
  expect(current?.approval).toBeUndefined()
  expect(current?.checkReport).toMatchObject({ passed: true, draftId: current!.id, draftRevision: current!.revision })
  expect(await wb.api.getDocumentFitReport(jobId)).toBeNull()
  expect(await wb.api.assertDraftExportable(jobId)).toMatchObject({ ok: false })
  expect(await wb.api.approveDraft(jobId)).toMatchObject({ ok: false })
}, 20000)

test('previously approved grouped legacy role and project remain exportable after backup restore', async () => {
  const { wb, dir, jobId, transport, setProposed } = await fixture()
  wb.close(); opened.splice(opened.indexOf(wb), 1)
  const sqlite = new Database(join(dir, 'workbench.sqlite'))
  registerWorkspaceBackupRowSizer(sqlite)
  const row = sqlite.prepare('SELECT id,data FROM draft_revisions WHERE job_id=? ORDER BY revision DESC LIMIT 1').get(jobId) as { id: string; data: string }
  const old = JSON.parse(row.data)
  for (const section of ['experience', 'projects'] as const) {
    const prior = old.content[section][0]
    delete prior.descriptionFormat
    old.content[section].push({ ...prior, text: section === 'experience' ? 'Improved delivery.' : 'Documented evaluation.' })
  }
  old.approved = false
  delete old.approval
  delete old.checkReport
  sqlite.prepare('UPDATE draft_revisions SET data=? WHERE id=?').run(JSON.stringify(old), row.id)
  sqlite.prepare('DELETE FROM document_fit_reports WHERE job_id=?').run(jobId)
  sqlite.close()
  let reopened = createWorkbench(dir, undefined, transport); opened.push(reopened)
  expect(await reopened.api.checkDraft(jobId)).toMatchObject({ passed: true })
  const canonical = await reopened.api.getCanonicalDocument(jobId)
  if (!canonical) throw Error('Legacy canonical missing')
  expect(canonical.sections.find(section => section.name === 'Experience')?.entries).toHaveLength(1)
  expect(canonical.sections.find(section => section.name === 'Projects')?.entries).toHaveLength(1)
  expect(canonical.sections.flatMap(section => section.entries).every(entry => !('descriptionFormat' in entry))).toBe(true)
  const legacyHash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
  await reopened.api.saveDocumentFitReport(jobId, { documentHash: legacyHash, targetPages: 1, actualPages: 1, extractedText: ['Built reliable services.', 'Built monitoring dashboard.'], linkTargets: [], links: [], overflow: false, proposedCuts: [], measuredAt: new Date().toISOString() })
  expect(await reopened.api.approveDraft(jobId)).toMatchObject({ ok: true, draft: { approval: { contentHash: legacyHash } } })
  expect(await reopened.api.assertDraftExportable(jobId)).toMatchObject({ ok: true })
  const backup = reopened.backup.createBackup()
  expect(reopened.backup.previewRestore(backup).rowCounts.draft_revisions.restored).toBeGreaterThan(0)
  const preview = reopened.backup.previewRestore(backup)
  reopened.backup.applyRestore(preview.token, content => { const path = join(dir, 'safety-backup.json'); writeFileSync(path, content, { flag: 'wx' }); return readFileSync(path, 'utf8') })
  reopened.close(); opened.splice(opened.indexOf(reopened), 1)
  reopened = createWorkbench(dir, undefined, transport); opened.push(reopened)
  expect(createHash('sha256').update(JSON.stringify(await reopened.api.getCanonicalDocument(jobId))).digest('hex')).toBe(legacyHash)
  expect(await reopened.api.assertDraftExportable(jobId)).toMatchObject({ ok: true, document: expect.any(Object) })
  expect(await reopened.api.getDraft(jobId)).toMatchObject({ approved: true, approval: { contentHash: legacyHash } })
  const authorize = async () => { const preview = await reopened.api.prepareOutboundConsent(jobId); if (!preview.ok) throw Error(preview.message); expect((await reopened.api.acceptOutboundConsent(preview.token, true, true)).ok).toBe(true); return preview.token }
  for (const [section, index, wording] of [['experience', 0, 'Improved delivery.'], ['projects', 1, 'Documented evaluation.']] as const) {
    setProposed(wording)
    const proposal = await reopened.api.regenerateDraft(await authorize(), { kind: 'paragraph', section, index })
    expect(proposal.ok).toBe(true)
    expect(await reopened.api.resolveRegenerationProposal(jobId, proposal.proposal!.id, 'accept')).toMatchObject({ draft: { approved: false } })
  }
  const mixed = await reopened.api.getCanonicalDocument(jobId)
  const experienceItems = mixed?.sections.find(section => section.name === 'Experience')?.entries[0].reviewItems
  const projectItems = mixed?.sections.find(section => section.name === 'Projects')?.entries[0].reviewItems
  expect(experienceItems?.map(item => item.descriptionFormat ?? 'bullets')).toEqual(['paragraph', 'bullets'])
  expect(projectItems?.map(item => item.descriptionFormat ?? 'bullets')).toEqual(['bullets', 'paragraph'])
  const mixedBackup = reopened.backup.createBackup()
  const mixedPreview = reopened.backup.previewRestore(mixedBackup)
  reopened.backup.applyRestore(mixedPreview.token, content => { const path = join(dir, 'mixed-safety-backup.json'); writeFileSync(path, content, { flag: 'wx' }); return readFileSync(path, 'utf8') })
  reopened.close(); opened.splice(opened.indexOf(reopened), 1)
  reopened = createWorkbench(dir, undefined, transport); opened.push(reopened)
  expect(await reopened.api.getCanonicalDocument(jobId)).toEqual(mixed)
}, 20000)
