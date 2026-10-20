import { StateGraph, Annotation, START, END } from '@langchain/langgraph'
import { z } from 'zod'
import { draftContentSchema, type DraftRevision } from '../shared/draft'

const scoredSchema = z.object({ relevance: z.array(z.object({ index: z.number().int().nonnegative(), score: z.number().min(0).max(1), rationale: z.string().min(1).max(500) }).strict()) }).strict()
const tailoredSchema = z.object({ education: z.array(z.object({ text: z.string(), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().min(1) }).strict()), experience: z.array(z.object({ text: z.string(), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().min(1) }).strict()), projects: z.array(z.object({ text: z.string(), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().min(1) }).strict()), skills: z.array(z.object({ name: z.string(), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().min(1) }).strict()), certificates: z.array(z.object({ text: z.string(), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().min(1) }).strict()) }).strict()

export type GenerationItem = { id: string; revision: number; category: 'education' | 'experience' | 'projects' | 'skills' | 'certificates'; snapshot: Record<string, unknown>; text: string; chronology?: string; parentId?: string }
const WORD_BUDGETS = { 1: { education: 105, experience: 300, projects: 135, skills: 100, certificates: 55 }, 2: { education: 190, experience: 570, projects: 260, skills: 180, certificates: 100 } } as const
const wordCount = (text: string) => {
  let content = text
  try {
    const parsed: unknown = JSON.parse(text)
    const strings = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(strings) : value && typeof value === 'object' ? Object.entries(value).filter(([key]) => !/^(id|revision)$/i.test(key)).flatMap(([, child]) => strings(child)) : typeof value === 'string' ? [value] : []
    content = strings(parsed).join(' ')
  } catch { /* plain text source */ }
  return content.trim().split(/\s+/).filter(Boolean).length
}
function selectWithinPageBudget(items: GenerationItem[], relevance: Array<{ index: number; score: number; rationale: string }>, target: 1 | 2) {
  const limit = WORD_BUDGETS[target]
  const selected: Array<{ index: number; score: number; rationale: string }> = []
  const usedByCategory = new Map<string, number>()
  const ranked = [...relevance].filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index)
  for (const candidate of ranked) {
    const item = items[candidate.index]
    const used = usedByCategory.get(item.category) ?? 0
    const estimate = Math.max(3, wordCount(item.text))
    if (used + estimate > limit[item.category]) continue
    selected.push(candidate)
    usedByCategory.set(item.category, used + estimate)
  }
  return selected.sort((a, b) => a.index - b.index)
}
export async function runSourceLinkedGraph(input: { job: unknown; analysis: unknown; items: GenerationItem[]; pageTarget?: 1 | 2; call(prompt: string, schema: z.ZodTypeAny): Promise<{ value: unknown; attempts: number }>; identity: { id: string; jobId: string; revision: number; createdAt: string; lockedFields: { fullName: string; headline?: string; experience: Array<{ evidenceId: string; title: string; organization: string; startDate?: string; endDate?: string }>; education: Array<{ evidenceId: string; title: string; institution?: string; startDate?: string; endDate?: string }>; projects: Array<{ evidenceId: string; name: string }>; certificates: Array<{ evidenceId: string; title: string; issuer?: string; year?: number }> } }; restoreText?: (text: string) => string }): Promise<{ draft: DraftRevision; attempts: number }> {
  const State = Annotation.Root({ scored: Annotation<z.infer<typeof scoredSchema> | undefined>(), tailored: Annotation<z.infer<typeof tailoredSchema> | undefined>(), attempts: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }) })
  const graph = new StateGraph(State)
    .addNode('batch_score', async () => {
      const response = await input.call(`Score these numbered eligible evidence items for relevance to the parsed job. Return one score and an inclusion rationale per item. Do not infer qualifications.\n${JSON.stringify({ job: input.job, analysis: input.analysis, items: input.items.map((item, index) => ({ index, category: item.category, text: item.text })) })}`, scoredSchema)
      const scored = scoredSchema.parse(response.value)
      const indices = scored.relevance.map(item => item.index)
      if (indices.some(index => index >= input.items.length) || new Set(indices).size !== indices.length || indices.length !== input.items.length) throw new Error('Batch scoring returned missing, duplicate, or foreign evidence indexes.')
      return { scored, attempts: response.attempts }
    })
    .addNode('tailor', async state => {
      const order = selectWithinPageBudget(input.items, state.scored?.relevance ?? [], input.pageTarget ?? 1)
      if (!order.length) throw new Error('No authorized profile evidence fits the selected page budget.')
      const selected = order.map(x => ({ ...input.items[x.index], index: x.index, rationale: x.rationale })).filter(x => x.id)
      const response = await input.call(`Write conservative paragraph descriptions and supported skill selections using only selected evidence. Cite selected integer evidence indexes. Keep responsibility/scope/certainty unchanged. Return exactly this schema.\n${JSON.stringify({ job: input.job, analysis: input.analysis, selected: selected.map(({ index, category, text }) => ({ index, category, text })) })}`, tailoredSchema)
      return { tailored: tailoredSchema.parse(response.value), attempts: response.attempts }
    })
    .addEdge(START, 'batch_score').addEdge('batch_score', 'tailor').addEdge('tailor', END).compile()
  const result = await graph.invoke({})
  const selected = selectWithinPageBudget(input.items, result.scored?.relevance ?? [], input.pageTarget ?? 1)
  if (!selected.length) throw new Error('No eligible profile evidence was selected for this posting.')
  const selectedIndices = new Set(selected.map(x => x.index))
  const itemFor = (indices: number[], category: GenerationItem['category']) => indices.map(index => {
    const item = input.items[index]
    if (!item || !selectedIndices.has(index) || item.category !== category) throw new Error('Generated draft referenced evidence outside the selected authorized sources.')
    return item
  })
  const buildParagraphs = (items: Array<{ text: string; evidence: number[]; rationale: string }>, category: GenerationItem['category']) => [...items].sort((a, b) => {
    if (category !== 'experience' && category !== 'education') return 0
    const latest = (entry: { evidence: number[] }) => Math.max(...entry.evidence.map(index => Date.parse(input.items[index]?.chronology ?? '') || 0))
    const byDate = latest(b) - latest(a)
    if (byDate) return byDate
    return Math.min(...a.evidence) - Math.min(...b.evidence)
  }).map(entry => {
    const cited = itemFor(entry.evidence, category)
    if ((category === 'experience' || category === 'projects') && new Set(cited.map(item => item.parentId ?? item.id)).size > 1) throw new Error('A generated paragraph cannot combine evidence from different experience or project parents.')
    return { text: input.restoreText?.(entry.text) ?? entry.text, citations: cited.map(item => ({ evidenceId: item.id, revision: item.revision })), rationale: entry.rationale }
  })
  const content = draftContentSchema.parse({
    education: buildParagraphs(result.tailored!.education, 'education'), experience: buildParagraphs(result.tailored!.experience, 'experience'), projects: buildParagraphs(result.tailored!.projects, 'projects'),
    skills: result.tailored!.skills.map(entry => { const cited = itemFor(entry.evidence, 'skills'); if (!cited.some(item => String(item.snapshot.name).toLowerCase() === entry.name.toLowerCase())) throw new Error('Generated skill is not present in cited profile evidence.'); return { name: entry.name, citations: cited.map(item => ({ evidenceId: item.id, revision: item.revision })), rationale: entry.rationale } }),
    certificates: buildParagraphs(result.tailored!.certificates, 'certificates')
  })
  const evidenceIds = new Set(Object.values(content).flatMap(section => section.flatMap(item => item.citations.map(c => c.evidenceId))))
  const evidence = input.items.filter(item => evidenceIds.has(item.id)).map(item => ({ evidenceId: item.id, revision: item.revision, snapshot: item.snapshot }))
  return { draft: { ...input.identity, pageTarget: input.pageTarget ?? 1, status: 'unverified', approved: false, content, evidence, progress: `Draft generated for a ${input.pageTarget ?? 1}-page target; automated verification and human approval have not run.`, attempts: result.attempts ?? 0 }, attempts: result.attempts ?? 0 }
}
