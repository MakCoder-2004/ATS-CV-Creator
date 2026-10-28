import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createWorkbench } from '../src/main/workbench'
import { mapProfilePdfPages } from '../src/shared/profile-pdf-import'

const directories: string[] = [], instances: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const instance of instances.splice(0)) instance.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

test('applies explicit add, update, and skip decisions against a populated profile without replacing unrelated facts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-populated-pdf-')); directories.push(directory)
  const workbench = createWorkbench(directory); instances.push(workbench)
  const savedContact = await workbench.api.saveContact({ fullName: 'Ada Lovelace', email: 'old@example.test' })
  const savedSkill = await workbench.api.saveSkill({ name: 'TypeScript', category: 'Technical' })
  const unrelatedSkill = await workbench.api.saveSkill({ name: 'SQLite', category: 'Tools' })
  if (!savedContact.ok || !savedSkill.ok || !unrelatedSkill.ok) throw new Error('Test profile setup failed')
  const baseline = await workbench.api.getProfileImportBaseline()
  const draft = mapProfilePdfPages([{ page: 1, text: 'NAME: Ada Lovelace\nEMAIL: ada@example.test\nSKILLS: TypeScript, Python' }])
  const refs = [draft.contact!.proposalRef, ...draft.skills.map(item => item.proposalRef), ...draft.sources.map(source => source.proposalRef)]
  const proposalIds = Object.fromEntries([...new Set(refs)].map(ref => [ref, randomUUID()]))
  const decisions: Record<string, { action: 'add' | 'update' | 'skip'; targetId?: string }> = {
    [draft.contact!.proposalRef]: { action: 'update', targetId: savedContact.value.contact!.id },
    [draft.skills[0].proposalRef]: { action: 'skip' },
    [draft.skills[1].proposalRef]: { action: 'add' }
  }
  const proposals = {
    ...draft,
    proposalIds,
    decisions,
    sources: draft.sources.map(source => ({ ...source, proposalId: proposalIds[source.proposalRef] }))
  }
  const imported = await workbench.api.importEmptyProfilePdf('a'.repeat(64), baseline, proposals)
  expect(imported.ok).toBe(true)
  if (!imported.ok || !imported.profile) throw new Error(imported.message)
  expect(imported.profile.contact).toMatchObject({ id: savedContact.value.contact!.id, revision: 2, email: 'ada@example.test' })
  expect(imported.profile.skills).toContainEqual(expect.objectContaining({ id: savedSkill.value.skills[0].id, name: 'TypeScript', revision: 1 }))
  expect(imported.profile.skills).toContainEqual(expect.objectContaining({ id: unrelatedSkill.value.skills.find(skill => skill.name === 'SQLite')!.id, name: 'SQLite', revision: 1 }))
  expect(imported.profile.skills.filter(skill => skill.name === 'Python')).toHaveLength(1)
})

test('rejects a populated-profile merge preview after the current profile baseline changes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-merge-stale-')); directories.push(directory)
  const workbench = createWorkbench(directory); instances.push(workbench)
  await workbench.api.saveSkill({ name: 'SQLite', category: 'Tools' })
  const baseline = await workbench.api.getProfileImportBaseline()
  const draft = mapProfilePdfPages([{ page: 1, text: 'SKILLS: Python' }])
  const refs = [...draft.skills.map(item => item.proposalRef), ...draft.sources.map(source => source.proposalRef)]
  const proposalIds = Object.fromEntries([...new Set(refs)].map(ref => [ref, randomUUID()]))
  const proposals = { ...draft, proposalIds, decisions: { [draft.skills[0].proposalRef]: { action: 'add' as const } }, sources: draft.sources.map(source => ({ ...source, proposalId: proposalIds[source.proposalRef] })) }
  await workbench.api.saveSkill({ name: 'TypeScript', category: 'Technical' })
  const result = await workbench.api.importEmptyProfilePdf('d'.repeat(64), baseline, proposals)
  expect(result).toMatchObject({ ok: false, message: expect.stringContaining('profile changed') })
  expect((await workbench.api.getProfile()).skills.map(skill => skill.name)).toEqual(['SQLite', 'TypeScript'])
})

test('rolls back every populated-profile merge write when a later selected addition conflicts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-merge-rollback-')); directories.push(directory)
  const workbench = createWorkbench(directory); instances.push(workbench)
  const contact = await workbench.api.saveContact({ fullName: 'Ada Lovelace', email: 'old@example.test' })
  const existingSkill = await workbench.api.saveSkill({ name: 'TypeScript', category: 'Technical' })
  if (!contact.ok || !existingSkill.ok) throw new Error('Test rollback profile setup failed')
  const before = await workbench.api.getProfile(), baseline = await workbench.api.getProfileImportBaseline()
  const draft = mapProfilePdfPages([{ page: 1, text: 'NAME: Ada Lovelace\nEMAIL: ada@example.test\nSKILLS: Python, TypeScript' }])
  const refs = [draft.contact!.proposalRef, ...draft.skills.map(item => item.proposalRef), ...draft.sources.map(source => source.proposalRef)]
  const proposalIds = Object.fromEntries([...new Set(refs)].map(ref => [ref, randomUUID()]))
  const proposals = { ...draft, proposalIds, decisions: { [draft.contact!.proposalRef]: { action: 'update' as const, targetId: contact.value.contact!.id }, [draft.skills[0].proposalRef]: { action: 'add' as const }, [draft.skills[1].proposalRef]: { action: 'add' as const } }, sources: draft.sources.map(source => ({ ...source, proposalId: proposalIds[source.proposalRef] })) }
  const result = await workbench.api.importEmptyProfilePdf('c'.repeat(64), baseline, proposals)
  expect(result.ok).toBe(false)
  expect(await workbench.api.getProfile()).toEqual(before)
  expect(JSON.parse(workbench.backup.createBackup()).tables.profile_import_provenance.rows).toEqual([])
})

test('merges updated experience and project records while preserving unrelated nested evidence and deduplicating repeated source support', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-nested-merge-')); directories.push(directory)
  const workbench = createWorkbench(directory); instances.push(workbench)
  const roleSaved = await workbench.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Example Labs', description: 'Existing role details', factualItems: [{ text: 'Maintained an internal API' }] })
  const projectSaved = await workbench.api.saveProject({ name: 'Atlas', description: 'Existing project details', factualItems: [{ text: 'Added a dashboard' }], technologies: [{ text: 'TypeScript' }], links: [{ label: 'Repository', url: 'https://example.test/atlas' }] })
  if (!roleSaved.ok || !projectSaved.ok) throw new Error('Test nested profile setup failed')
  const role = roleSaved.value.experience[0], project = projectSaved.value.projects[0]
  const draft = mapProfilePdfPages([{ page: 1, text: 'EXPERIENCE: Example Labs | Engineer\nFACT: Built a data pipeline\nPROJECT: Atlas | React\nFACT: Added offline support' }])
  const refs = [...draft.experience.flatMap(item => [item.proposalRef, ...item.factualItems.map(fact => fact.proposalRef)]), ...draft.projects.flatMap(item => [item.proposalRef, ...item.factualItems.map(fact => fact.proposalRef), ...item.technologies.map(technology => technology.proposalRef)]), ...draft.sources.map(source => source.proposalRef)]
  const makeReviewedProposal = () => {
    const proposalIds = Object.fromEntries([...new Set(refs)].map(ref => [ref, randomUUID()]))
    return { ...draft, proposalIds, decisions: { [draft.experience[0].proposalRef]: { action: 'update' as const, targetId: role.id }, [draft.projects[0].proposalRef]: { action: 'update' as const, targetId: project.id }, ...Object.fromEntries([...draft.experience.flatMap(item => item.factualItems), ...draft.projects.flatMap(item => [...item.factualItems, ...item.technologies])].map(item => [item.proposalRef, { action: 'add' as const }])) }, sources: draft.sources.map(source => ({ ...source, proposalId: proposalIds[source.proposalRef] })) }
  }
  const first = await workbench.api.importEmptyProfilePdf('b'.repeat(64), await workbench.api.getProfileImportBaseline(), makeReviewedProposal())
  if (!first.ok || !first.experience) throw new Error(first.message)
  expect(first.ok).toBe(true)
  expect(first.experience.experience[0]).toMatchObject({ id: role.id, revision: 2, factualItems: [{ id: role.factualItems[0].id, revision: 1, text: 'Maintained an internal API' }, { text: 'Built a data pipeline' }] })
  expect(first.experience.projects[0]).toMatchObject({ id: project.id, revision: 2, technologies: [{ id: project.technologies[0].id, text: 'TypeScript' }, { text: 'React' }], links: [{ url: 'https://example.test/atlas' }], factualItems: [{ text: 'Added a dashboard' }, { text: 'Added offline support' }] })
  const nestedId = first.experience.experience[0].factualItems.find(fact => fact.text === 'Built a data pipeline')!.id
  const beforeHistory = await workbench.api.getEvidenceHistory(role.id)
  const beforeProvenance = JSON.parse(workbench.backup.createBackup()).tables.profile_import_provenance.rows
  expect(beforeProvenance).toContainEqual(expect.objectContaining({ owner_id: role.id, owner_revision: 2, source_hash: 'b'.repeat(64) }))
  expect(beforeProvenance).toContainEqual(expect.objectContaining({ owner_id: nestedId, owner_revision: 1, passage: 'FACT: Built a data pipeline' }))
  const repeated = await workbench.api.importEmptyProfilePdf('b'.repeat(64), await workbench.api.getProfileImportBaseline(), makeReviewedProposal())
  expect(repeated.ok).toBe(true)
  if (!repeated.ok || !repeated.experience) throw new Error(repeated.message)
  expect(repeated.experience.experience[0]).toEqual(first.experience.experience[0])
  expect(repeated.experience.experience[0].factualItems.find(fact => fact.text === 'Built a data pipeline')!.id).toBe(nestedId)
  expect(await workbench.api.getEvidenceHistory(role.id)).toEqual(beforeHistory)
  const afterProvenance = JSON.parse(workbench.backup.createBackup()).tables.profile_import_provenance.rows
  expect(afterProvenance).toHaveLength(beforeProvenance.length)
})

test('accepts profile import IDs only for dispatched attempt history, not posting consent or recovery', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-profile-attempt-backup-')); directories.push(directory)
  const workbench = createWorkbench(directory); instances.push(workbench)
  const valid = JSON.parse(workbench.backup.createBackup())
  const profileRun = `profile-import:${randomUUID()}`
  const now = new Date().toISOString()
  valid.tables.analysis_attempts.rows.push({ id: 1, run_id: profileRun, attempted_at: now })
  valid.tables.provider_attempt_outcomes.rows.push({ id: 1, run_id: profileRun, dispatched_at: now, outcome: 'response', settled_at: now, checkpointed_at: null })
  expect(() => workbench.backup.previewRestore(JSON.stringify(valid))).not.toThrow()
  for (const table of ['analysis_attempts', 'provider_attempt_outcomes'] as const) {
    const forged = structuredClone(valid)
    forged.tables[table].rows[0].run_id = 'profile-import:not-a-uuid'
    expect(() => workbench.backup.previewRestore(JSON.stringify(forged))).toThrow(table)
  }
  const consent = structuredClone(valid)
  const scopeHash = 'a'.repeat(64)
  consent.tables.outbound_consents.rows.push({ id: randomUUID(), run_id: randomUUID(), scope_hash: scopeHash, created_at: now, revoked: 0, job_id: null, purpose_version: 1, purpose: 'cv', purpose_hash: createHash('sha256').update(JSON.stringify({ version: 1, scopeHash, purpose: 'cv' })).digest('hex') })
  expect(() => workbench.backup.previewRestore(JSON.stringify(consent))).not.toThrow()
  consent.tables.outbound_consents.rows[0].run_id = profileRun
  expect(() => workbench.backup.previewRestore(JSON.stringify(consent))).toThrow('outbound_consents')
  const recovery = structuredClone(valid)
  recovery.tables.generation_recovery_extensions.rows.push({ id: 1, run_id: profileRun, prior_run_limit: 1, new_run_limit: 2, prior_time_limit_ms: 1000, new_time_limit_ms: 2000, recorded_at: now })
  expect(() => workbench.backup.previewRestore(JSON.stringify(recovery))).toThrow('generation_recovery_extensions')
})

test('rejects provenance attached to another owner type or field before workspace restore', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-forged-provenance-')); directories.push(directory)
  const workbench = createWorkbench(directory); instances.push(workbench)
  const baseline = await workbench.api.getProfileImportBaseline()
  const draft = mapProfilePdfPages([{ page: 1, text: 'NAME: Ada Example\nSKILLS: TypeScript' }])
  const refs = [draft.contact!.proposalRef, ...draft.skills.map(item => item.proposalRef), ...draft.sources.map(source => source.proposalRef)]
  const proposalIds = Object.fromEntries([...new Set(refs)].map(ref => [ref, randomUUID()]))
  const proposal = { ...draft, proposalIds, sources: draft.sources.map(source => ({ ...source, proposalId: proposalIds[source.proposalRef] })) }
  expect((await workbench.api.importEmptyProfilePdf('e'.repeat(64), baseline, proposal)).ok).toBe(true)
  const valid = workbench.backup.createBackup()
  expect(() => workbench.backup.previewRestore(valid)).not.toThrow()
  const before = await workbench.api.getProfile()
  for (const forgedField of ['projects.project', 'contact.links']) {
    const forged = JSON.parse(valid)
    const support = forged.tables.profile_import_provenance.rows.find((row: { field: string }) => row.field === 'contact.fullName')
    support.field = forgedField
    expect(() => workbench.backup.previewRestore(JSON.stringify(forged))).toThrow('profile_import_provenance')
    expect(await workbench.api.getProfile()).toEqual(before)
  }
})

test('retains entry field provenance only on the matching section with a present property', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-entry-provenance-')); directories.push(directory)
  const workbench = createWorkbench(directory); instances.push(workbench)
  const mapped = mapProfilePdfPages([{ page: 1, text: 'EDUCATION: BSc | Example Institute | GPA 3.8\nCERTIFICATE: Cloud Basics | Example Academy | 2021' }])
  const certificate = mapped.entries.find(entry => entry.section === 'certificates')!
  const proposals = {
    ...mapped,
    entries: mapped.entries.map(entry => entry === certificate ? { ...entry, link: 'https://example.test/certificate' } : entry),
    sources: [...mapped.sources, ...(['entries.education.institution', 'entries.education.description'].map(field => ({ proposalRef: mapped.entries[0]!.proposalRef, page: 1, passage: 'EDUCATION: BSc | Example Institute | GPA 3.8', field }))), { proposalRef: certificate.proposalRef, page: 1, passage: 'Certificate — https://example.test/certificate', field: 'entries.certificates.link' }]
  }
  const proposalIds = Object.fromEntries(proposals.entries.map(entry => [entry.proposalRef, randomUUID()]))
  const imported = await workbench.api.importEmptyProfilePdf('f'.repeat(64), await workbench.api.getProfileImportBaseline(), { ...proposals, proposalIds, sources: proposals.sources.map(source => ({ ...source, proposalId: proposalIds[source.proposalRef] })) })
  expect(imported.ok).toBe(true)
  const valid = JSON.parse(workbench.backup.createBackup())
  const support = valid.tables.profile_import_provenance.rows as Array<{ owner_id: string; owner_revision: number; field: string }>
  for (const field of ['entries.education.institution', 'entries.education.description', 'entries.certificates.link']) expect(support.some(row => row.field === field)).toBe(true)
  expect(() => workbench.backup.previewRestore(JSON.stringify(valid))).not.toThrow()
  for (const [field, wrong] of [['entries.education.institution', 'entries.certificates.link'], ['entries.certificates.link', 'entries.education.institution']] as const) {
    const forged = structuredClone(valid)
    forged.tables.profile_import_provenance.rows.find((row: { field: string }) => row.field === field).field = wrong
    expect(() => workbench.backup.previewRestore(JSON.stringify(forged))).toThrow('profile_import_provenance')
  }
  for (const [field, property] of [['entries.education.institution', 'institution'], ['entries.education.description', 'description'], ['entries.certificates.link', 'link']] as const) {
    const forged = structuredClone(valid)
    const row = forged.tables.profile_import_provenance.rows.find((item: { field: string }) => item.field === field)
    const revision = forged.tables.evidence_revisions.rows.find((item: { id: string; revision: number }) => item.id === row.owner_id && item.revision === row.owner_revision)
    const snapshot = JSON.parse(revision.snapshot)
    delete snapshot[property]
    revision.snapshot = JSON.stringify(snapshot)
    expect(() => workbench.backup.previewRestore(JSON.stringify(forged))).toThrow('profile_import_provenance')
  }
})

test('restores a pre-provenance workspace backup as empty provenance while retaining profile and evidence history', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-legacy-pdf-backup-')); directories.push(directory)
  const workbench = createWorkbench(directory); instances.push(workbench)
  const sourceHash = 'a'.repeat(64), baseline = await workbench.api.getProfileImportBaseline()
  const draft = mapProfilePdfPages([{ page: 1, text: 'NAME: Ada Example\nSKILLS: TypeScript' }])
  const refs = [draft.contact?.proposalRef, ...draft.skills.map(item => item.proposalRef), ...draft.sources.map(source => source.proposalRef)].filter((ref): ref is string => Boolean(ref))
  const proposalIds = Object.fromEntries([...new Set(refs)].map(ref => [ref, randomUUID()]))
  const proposals = { ...draft, proposalIds, sources: draft.sources.map(source => ({ ...source, proposalId: proposalIds[source.proposalRef] })) }
  const imported = await workbench.api.importEmptyProfilePdf(sourceHash, baseline, proposals)
  expect(imported.ok).toBe(true)
  const legacy = JSON.parse(workbench.backup.createBackup())
  delete legacy.tables.profile_import_provenance
  legacy.tables.schema_migrations.rows = legacy.tables.schema_migrations.rows.filter((row: { version: number }) => row.version !== 6)
  const preview = workbench.backup.previewRestore(JSON.stringify(legacy))
  expect(preview.rowCounts.profile_import_provenance).toEqual({ current: 2, restored: 0 })
  workbench.backup.applyRestore(preview.token, content => content)
  expect(await workbench.api.getProfile()).toMatchObject({ contact: { fullName: 'Ada Example' }, skills: [{ name: 'TypeScript' }] })
  expect(JSON.parse(workbench.backup.createBackup()).tables.profile_import_provenance.rows).toEqual([])
})
