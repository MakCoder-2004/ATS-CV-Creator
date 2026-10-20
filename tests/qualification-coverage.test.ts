import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { analysisBudgetValues } from '../src/shared/posting-analysis'

const workspaces: Array<ReturnType<typeof createWorkbench>> = [], directories: string[] = []
afterEach(() => { for (const workspace of workspaces.splice(0)) workspace.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })

test('public workbench reports evidence-backed matches and advisory gaps without blocking a partial match', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qualification-coverage-')); directories.push(dir)
  const transport: AnalysisTransport = { async generate({ prompt }) {
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: ['JavaScript'], preferred: ['Kubernetes'], tools: [], responsibilities: [], keywords: ['JavaScript', 'Kubernetes'] })
    if (prompt.startsWith('Score these numbered')) { const { items } = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant source.' })) }) }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const experience = selected.filter((item: { category: string }) => item.category === 'experience')
    return JSON.stringify({ education: [], experience: experience.map((item: { index: number; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'Directly supported.' })), projects: [], skills: [], certificates: [] })
  } }
  const wb = createWorkbench(dir, undefined, transport); workspaces.push(wb)
  const usage = await wb.api.getAnalysisUsage(); await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(usage), minimumSpacingMs: 0 })
  const role = await wb.api.saveExperience({ kind: 'employment', title: 'Developer', organization: 'Local Employer', description: 'Built JS applications.' })
  const job = await wb.api.saveJob({ title: 'Developer', company: 'Target', description: 'JavaScript required; Kubernetes preferred.' })
  if (!role.ok || !job.ok) throw Error('Could not create coverage fixtures')
  const consent = await wb.api.prepareOutboundConsent(job.value.id); if (!consent.ok) throw Error('Could not prepare consent')
  await wb.api.acceptOutboundConsent(consent.token, true, true)
  await wb.api.startAnalysis(consent.token)
  const generated = await wb.api.generateDraft(consent.token)
  expect(generated).toMatchObject({ ok: true, draft: { status: 'unverified', coverage: { label: expect.stringContaining('not a universal ATS score'), repairAttempts: 0, factualChecksRerun: true, supportedMatches: [{ qualification: 'JavaScript', kind: 'required', matchedAs: 'js' }], gaps: [{ qualification: 'Kubernetes', kind: 'preferred' }] } } })
  expect(await wb.api.getDraft(job.value.id)).toMatchObject({ coverage: { gaps: [{ qualification: 'Kubernetes' }] } })
})
