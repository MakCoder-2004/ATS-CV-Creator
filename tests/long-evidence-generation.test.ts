import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { analysisBudgetValues } from '../src/shared/posting-analysis'

const directories: string[] = []
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })

test('a long saved role can yield a concise cited one-page CV', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'long-evidence-generation-')); directories.push(dir)
  const requests: string[] = []
  const transport: AnalysisTransport = { async generate({ prompt }) {
    requests.push(prompt)
    if (prompt.startsWith('Extract only explicit qualifications')) return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: [], responsibilities: [], keywords: [] })
    if (prompt.startsWith('Score these numbered')) {
      const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant saved evidence.' })) })
    }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const role = selected.find((item: { category: string }) => item.category === 'experience')
    if (!role) throw Error('The saved role was not offered for concise wording.')
    return JSON.stringify({ education: [], experience: [{ text: 'Built TypeScript services.', evidence: [role.index], rationale: 'Directly supported.' }], projects: [], skills: [] })
  } }
  const wb = createWorkbench(dir, undefined, transport)
  try {
    await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(await wb.api.getAnalysisUsage()), minimumSpacingMs: 0 })
    const sourceText = `Built TypeScript services. ${'Maintained the same reliable service. '.repeat(350)}`
    const role = await wb.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Example Employer', description: sourceText })
    const job = await wb.api.saveJob({ title: 'Engineer', company: 'Example Company', description: 'TypeScript is required.' })
    if (!role.ok || !job.ok) throw Error('Could not save the profile and posting.')
    const preview = await wb.api.prepareOutboundConsent(job.value.id)
    if (!preview.ok) throw Error(preview.message)
    await wb.api.acceptOutboundConsent(preview.token, true, true)
    expect((await wb.api.startAnalysis(preview.token)).status).toBe('complete')
    const result = await wb.api.generateDraft(preview.token, 1)
    expect(result).toMatchObject({ ok: true, draft: { content: { experience: [{ text: 'Built TypeScript services.' }] } } })
    expect(result.draft?.content.experience[0].citations[0].evidenceId).toBe(role.value.experience[0].id)
    expect(requests.some(prompt => prompt.startsWith('Write concise'))).toBe(true)
    expect((await wb.api.getExperience()).experience[0].description).toBe(sourceText)
  } finally { wb.close() }
})
