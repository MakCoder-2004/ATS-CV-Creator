import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { createWorkbench } from '../../src/main/workbench'
import { registerWorkspaceBackupRowSizer } from '../../src/main/workspace-backup'
import type { AnalysisTransport } from '../../src/main/posting-analysis'

export async function artifactFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'letter-controller-'))
  const prompts: string[] = []
  const transport: AnalysisTransport = { async generate({ prompt }) {
    prompts.push(prompt)
    if (prompt.startsWith('Extract only explicit')) return JSON.stringify({ required: [], preferred: [], tools: ['Rust'], responsibilities: [], keywords: [] })
    if (prompt.startsWith('Score these numbered')) {
      const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Saved source.' })) })
    }
    if (prompt.startsWith('Write one cover letter')) {
      const { sources } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ paragraphs: [{ text: "I've practiced TypeScript — building reliable tools…", citations: [{ ordinal: sources.find((s: { category: string }) => s.category === 'experience').ordinal }] }] })
    }
    const request = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const skill = request.selected.find((s: { category: string }) => s.category === 'skills')
    return JSON.stringify({ education: [], experience: request.experienceGroups.map(({ indexes }: { indexes: number[] }) => ({ text: 'Practiced TypeScript exercises.', evidence: indexes, rationale: 'Saved training.' })), projects: [], skills: [{ name: 'TypeScript', evidence: [skill.index], rationale: 'Saved skill.' }] })
  } }
  let wb = createWorkbench(dir, undefined, transport)
  await wb.api.saveContact({ fullName: 'Zoë Candidate', email: 'zoe@example.test', headline: 'Never print headline', links: [{ label: 'Private link', url: 'https://example.test/private' }] })
  await wb.api.saveSkill({ name: 'TypeScript', category: 'Programming' })
  await wb.api.saveExperience({ kind: 'training', title: 'Trainee', organization: 'Learning group', description: 'Practiced TypeScript exercises.', factualItems: [{ text: 'Practiced TypeScript.' }] })
  const saved = await wb.api.saveJob({ title: 'Developer', company: 'Example', description: 'Build tools with Rust.' })
  if (!saved.ok) throw new Error('Job setup failed')
  const jobId = saved.value.id
  const grant = await wb.api.prepareOutboundConsent(jobId, 'cv+cover-letter')
  if (!grant.ok) throw new Error(grant.message)
  await wb.api.acceptOutboundConsent(grant.token, true, true)
  await wb.api.startAnalysis(grant.token)
  const result = await wb.api.generateRequestedDocuments(grant.token)
  if (result.letter.status !== 'saved') throw new Error(JSON.stringify(result))
  const letter = result.letter.letter
  const mutate = (update: (data: typeof letter) => void) => {
    const db = new Database(join(dir, 'workbench.sqlite')); registerWorkspaceBackupRowSizer(db)
    try {
      const row = db.prepare('SELECT data FROM cover_letter_revisions WHERE job_id=? ORDER BY revision DESC LIMIT 1').get(jobId) as { data: string }
      const data = JSON.parse(row.data); update(data)
      db.prepare('UPDATE cover_letter_revisions SET data=? WHERE id=?').run(JSON.stringify(data), data.id)
    } finally { db.close() }
  }
  return {
    dir, jobId, letter, prompts, transport, mutate,
    get wb() { return wb },
    reopen() { wb.close(); wb = createWorkbench(dir, undefined, transport); return wb },
    cleanup() { wb.close(); rmSync(dir, { recursive: true, force: true }) },
    roots: { toolchainRoot: resolve('.tools/latex'), templateRoot: resolve('resources/cover-letter-template/application'), tempRoot: join(dir, 'compiler') },
  }
}
