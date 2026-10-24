import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

test.each(['factual', 'coverage'] as const)('%s repair never sends a restored employer name outside the approved outgoing data', async mode => {
  const dir = mkdtempSync(join(tmpdir(), 'generation-privacy-'))
  dirs.push(dir)
  const requests: string[] = []
  const transport: AnalysisTransport = { async generate({ prompt }) {
    requests.push(prompt)
    if (prompt.startsWith('Extract only explicit qualifications')) return JSON.stringify({ required: mode === 'coverage' ? ['JavaScript'] : [], preferred: [], tools: [], responsibilities: [], keywords: [] })
    if (prompt.startsWith('Score these numbered')) {
      const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant saved role.' })) })
    }
    if (prompt.startsWith('Factual repair cycle') || prompt.startsWith('Supported-keyword coverage repair')) return JSON.stringify({ corrections: [] })
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const role = selected.find((item: { category: string }) => item.category === 'experience')
    const employerToken = /\[\[EMPLOYER_\d+\]\]/.exec(role.text)?.[0]
    if (!employerToken) throw Error('Expected a minimized employer in the model input.')
    return JSON.stringify({ education: [], experience: [{ text: mode === 'coverage' ? `Built ${employerToken} services.` : `Built ${employerToken} services with 500 percent growth.`, evidence: [role.index], rationale: 'Relevant role.' }], projects: [], skills: [] })
  } }
  const wb = createWorkbench(dir, undefined, transport)
  try {

    const role = await wb.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Secret Employer', description: 'Built JS services at Secret Employer.' })
    const job = await wb.api.saveJob({ title: 'Engineer', company: 'Example Co', description: 'Build services.' })
    if (!role.ok || !job.ok) throw Error('Fixture could not be saved.')
    const preview = await wb.api.prepareOutboundConsent(job.value.id)
    if (!preview.ok) throw Error(preview.message)
    expect(JSON.stringify(preview.outgoing)).not.toContain('Secret Employer')
    expect(await wb.api.acceptOutboundConsent(preview.token, true, true)).toMatchObject({ ok: true })
    expect(await wb.api.startAnalysis(preview.token)).toMatchObject({ status: 'complete' })
    const result = await wb.api.generateDraft(preview.token)
    expect(result).toMatchObject({ ok: true, draft: { status: mode === 'factual' ? 'blocked' : 'unverified' } })
    expect(requests.some(prompt => prompt.startsWith(mode === 'factual' ? 'Factual repair cycle' : 'Supported-keyword coverage repair'))).toBe(true)
    expect(requests.join('\n')).not.toContain('Secret Employer')
  } finally { wb.close() }
})
