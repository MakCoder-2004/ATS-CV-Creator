import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { createWorkbench } from '../../src/main/workbench'
import { registerWorkspaceBackupRowSizer } from '../../src/main/workspace-backup'
import type { createCoverLetterCompiler } from '../../src/main/cover-letter-compiler'
import type { PiModelRuntime } from '../../src/main/pi-model'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { AnalysisTransport } from '../../src/main/posting-analysis'

export async function artifactFixture(pi = false, twoRoles = false) {
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
  const model = { id: 'synthetic', provider: 'sample', name: 'Synthetic', api: 'openai-completions', baseUrl: 'https://example.invalid', input: ['text'], reasoning: true, contextWindow: 16384, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as Model<Api>
  const runtime = {
    getProviders: () => [{ id: model.provider, getModels: () => [model] }], getPhysicalModel: () => model, getAvailable: async () => [model], getAuth: async () => ({ source: 'synthetic' }),
    completeSimple: async (_model: unknown, context: { messages: Array<{ content: string }> }, request: { signal: AbortSignal }) => ({ role: 'assistant', provider: model.provider, model: model.id, stopReason: 'stop', content: [{ type: 'text', text: await transport.generate({ model: model.id, prompt: context.messages.at(-1)!.content, signal: request.signal, responseSchema: {} as never }) }], usage: { output: 28 } }),
  } as unknown as PiModelRuntime
  let wb = createWorkbench(dir, undefined, pi ? undefined : transport, undefined, pi ? runtime : undefined)
  if (pi) await wb.api.setPiModel({ reference: 'sample/synthetic', thinkingLevel: 'low' })
  await wb.api.saveContact({ fullName: 'Zoë Candidate', email: 'zoe@example.test', headline: 'Never print headline', links: [{ label: 'Private link', url: 'https://example.test/private' }] })
  await wb.api.saveSkill({ name: 'TypeScript', category: 'Programming' })
  await wb.api.saveExperience({ kind: twoRoles ? 'employment' : 'training', title: twoRoles ? 'Engineer' : 'Trainee', organization: twoRoles ? 'Alpha' : 'Learning group', description: twoRoles ? 'Practiced TypeScript exercises and maintained dashboards.' : 'Practiced TypeScript exercises.', factualItems: [{ text: 'Practiced TypeScript.' }] })
  if (twoRoles) await wb.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Beta', description: 'Practiced TypeScript exercises. Reduced latency by 20% using Rust.', factualItems: [{ text: 'Reduced latency by 20% using Rust.' }] })
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
    reopen(compiler?: ReturnType<typeof createCoverLetterCompiler>) { wb.close(); wb = createWorkbench(dir, undefined, pi ? undefined : transport, undefined, pi ? runtime : undefined, compiler); return wb },
    cleanup() { wb.close(); rmSync(dir, { recursive: true, force: true }) },
    roots: { toolchainRoot: resolve('.tools/latex'), templateRoot: resolve('resources/cover-letter-template/application'), tempRoot: join(dir, 'compiler') },
  }
}
