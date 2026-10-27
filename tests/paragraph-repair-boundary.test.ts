import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import { countEnglishWords } from '../src/shared/draft'
import type { AnalysisTransport } from '../src/main/posting-analysis'

const opened: Array<ReturnType<typeof createWorkbench>> = []
const directories: string[] = []
afterEach(() => { for (const wb of opened.splice(0)) wb.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5 }) })

const sixtyWords = Array(20).fill('Built stable systems').join(' ')

async function runCase(mode: 'coverage' | 'factual', correction: string) {
  const dir = mkdtempSync(join(tmpdir(), 'paragraph-repair-')); directories.push(dir)
  const requests: Array<{ kind: string; stage: string; selectedCount?: number; findingsCount?: number; opportunity?: boolean; citedEvidenceCount?: number; citedEvidenceType?: string; responseSchema?: string; thrown?: string }> = []
  const transport: AnalysisTransport = { async generate({ prompt, responseSchema }) {
    const kind = prompt.startsWith('Extract only explicit qualifications') ? 'extract' : prompt.startsWith('Score these numbered') ? 'score' : prompt.startsWith('Factual repair cycle') ? 'factual-repair' : prompt.startsWith('Supported-keyword coverage repair') ? 'coverage-repair' : 'generate'
    const call: (typeof requests)[number] = { kind, stage: 'entered', responseSchema: typeof responseSchema === 'object' && responseSchema !== null && 'name' in responseSchema ? String((responseSchema as { name: unknown }).name).slice(0, 40) : typeof responseSchema }
    requests.push(call)
    const parseBody = () => {
      call.stage = 'prompt-json-parse'
      const parsed = JSON.parse(prompt.slice(prompt.indexOf('{')))
      call.selectedCount = Array.isArray(parsed.selected) ? parsed.selected.length : undefined
      call.findingsCount = Array.isArray(parsed.findings) ? parsed.findings.length : undefined
      call.opportunity = parsed.opportunity !== undefined
      const finding = parsed.findings?.[0]
      const cited = finding?.citedEvidence
      call.citedEvidenceCount = Array.isArray(cited) ? cited.length : undefined
      call.citedEvidenceType = cited === undefined ? 'absent' : Array.isArray(cited) ? 'array' : typeof cited
      return parsed
    }
    try {
      let response: string
      if (kind === 'extract') response = JSON.stringify({ required: mode === 'coverage' ? ['TypeScript'] : [], preferred: [], tools: [], responsibilities: [], keywords: [] })
      else if (kind === 'score') { const { items } = parseBody(); response = JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant.' })) }) }
      else if (kind === 'factual-repair' || kind === 'coverage-repair') {
        const { findings, opportunity } = parseBody()
        call.stage = 'select-finding'
        const index = mode === 'factual' ? findings[0].index : opportunity.index
        const evidenceId = mode === 'factual' ? findings[0].citedEvidence[0].evidenceId : opportunity.evidenceId
        const revision = mode === 'factual' ? findings[0].citedEvidence[0].revision : opportunity.revision
        response = JSON.stringify({ corrections: [{ section: 'experience', index, text: correction, citations: [{ evidenceId, revision }] }] })
      } else {
        const { selected } = parseBody(); call.stage = 'select-role'
        const role = selected.find((item: { category: string }) => item.category === 'experience')
        response = JSON.stringify({ headline: 'Engineer', summary: { text: 'Built stable systems.', evidence: [role.index], rationale: 'Saved.' }, education: [], experience: [{ text: mode === 'coverage' ? sixtyWords : 'Built 99 stable systems.', evidence: [role.index], rationale: 'Saved.' }], projects: [], skills: [], certificates: [] })
      }
      if (typeof responseSchema === 'object' && responseSchema !== null && 'safeParse' in responseSchema && typeof responseSchema.safeParse === 'function') {
        call.stage = 'response-schema-check'
        const result = responseSchema.safeParse(JSON.parse(response))
        call.responseSchema = result.success ? 'valid' : `invalid:${String(result.error.issues[0]?.code ?? 'unknown').slice(0, 24)}`
      }
      call.stage = 'response-ready'
      return response
    } catch (error) { call.thrown = error instanceof Error ? error.constructor.name : 'unknown'; call.stage = 'fixture-threw'; throw error }
  } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  const role = await wb.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Sample', description: mode === 'coverage' ? `${sixtyWords} TypeScript` : 'Built 12 stable systems.' })
  const job = await wb.api.saveJob({ title: 'Engineer', company: 'Target', description: mode === 'coverage' ? 'TypeScript required.' : 'Build stable systems.' })
  if (!role.ok || !job.ok) throw new Error('Fixture failed.')
  const preview = await wb.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw new Error(preview.message)
  expect((await wb.api.acceptOutboundConsent(preview.token, true, true)).ok).toBe(true)
  expect((await wb.api.startAnalysis(preview.token)).status).toBe('complete')
  const generated = await wb.api.generateDraft(preview.token)
  const safeText = (value: string | undefined) => (value ?? '')
    .replaceAll(sixtyWords, '[long evidence omitted]')
    .replaceAll('TypeScript', '[skill]')
    .replaceAll('Built 12 stable systems.', '[source wording omitted]')
    .replaceAll('Built 99 stable systems.', '[generated wording omitted]')
    .replaceAll('Engineer', '[role]')
    .replaceAll('Sample', '[organization]')
    .replaceAll('Target', '[target]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 300)
  const diagnostic = JSON.stringify({ message: safeText(generated.message), status: generated.draft?.status ?? 'no-draft', progress: safeText(generated.draft?.progress), calls: requests }).slice(0, 1200)
  expect(generated.ok, `Bounded scripted generation diagnostic: ${diagnostic}`).toBe(true)
  return { generated, requests, jobId: job.value.id, wb }
}

test('a supported term cannot turn a valid 60-word paragraph into a 61-word saved paragraph', async () => {
  expect(countEnglishWords(sixtyWords)).toBe(60)
  const { generated, requests, jobId, wb } = await runCase('coverage', `TypeScript ${sixtyWords}`)
  expect(requests.filter(call => call.kind === 'coverage-repair')).toHaveLength(1)
  expect(generated.draft?.content.experience[0]).toMatchObject({ text: sixtyWords, descriptionFormat: 'paragraph' })
  expect((await wb.api.getDraft(jobId))?.content.experience[0].text).toBe(sixtyWords)
})

test.each(['Built 12 stable systems.\nOwned delivery.', '- Built 12 stable systems.', `${sixtyWords} TypeScript`])('factual correction with invalid paragraph shape cannot replace the cited wording (%s)', async correction => {
  const { generated, requests, jobId, wb } = await runCase('factual', correction)
  expect(requests.filter(call => call.kind === 'factual-repair')).toHaveLength(2)
  expect(generated.draft).toMatchObject({ status: 'blocked', checkReport: { passed: false } })
  expect(generated.draft?.content.experience[0].text).toBe('Built 99 stable systems.')
  expect((await wb.api.getDraft(jobId))?.content.experience[0].text).toBe('Built 99 stable systems.')
})
