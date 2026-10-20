import { StateGraph, Annotation, START, END } from '@langchain/langgraph'
import { z } from 'zod'
import { draftContentSchema, type DraftRevision } from '../shared/draft'

const scoredSchema = z.object({ relevance: z.array(z.object({ index: z.number().int().nonnegative(), score: z.number().min(0).max(1), rationale: z.string().min(1).max(500) }).strict()) }).strict()
const tailoredSchema = z.object({ education: z.array(z.object({ text: z.string(), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().min(1) }).strict()), experience: z.array(z.object({ text: z.string(), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().min(1) }).strict()), projects: z.array(z.object({ text: z.string(), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().min(1) }).strict()), skills: z.array(z.object({ name: z.string(), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().min(1) }).strict()), certificates: z.array(z.object({ text: z.string(), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().min(1) }).strict()) }).strict()

export type GenerationItem = { id: string; revision: number; category: 'education' | 'experience' | 'projects' | 'skills' | 'certificates'; snapshot: Record<string, unknown>; text: string; chronology?: string }
export async function runSourceLinkedGraph(input: { job: unknown; analysis: unknown; items: GenerationItem[]; call(prompt: string, schema: z.ZodTypeAny): Promise<{ value: unknown; attempts: number }>; identity: { id: string; jobId: string; revision: number; createdAt: string; lockedFields: { fullName: string; headline?: string; experience: Array<{ evidenceId: string; title: string; organization: string; startDate?: string; endDate?: string }>; education: Array<{ evidenceId: string; title: string; institution?: string; startDate?: string; endDate?: string }>; projects: Array<{ evidenceId: string; name: string }>; certificates: Array<{ evidenceId: string; title: string; issuer?: string; year?: number }> } }; restoreText?: (text: string) => string }): Promise<{ draft: DraftRevision; attempts: number }> {
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
      const order = [...(state.scored?.relevance ?? [])].filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 24)
      const selected = order.map(x => ({ ...input.items[x.index], index: x.index, rationale: x.rationale })).filter(x => x.id)
      const response = await input.call(`Write conservative paragraph descriptions and supported skill selections using only selected evidence. Cite selected integer evidence indexes. Keep responsibility/scope/certainty unchanged. Return exactly this schema.\n${JSON.stringify({ job: input.job, analysis: input.analysis, selected: selected.map(({ index, category, text }) => ({ index, category, text })) })}`, tailoredSchema)
      return { tailored: tailoredSchema.parse(response.value), attempts: response.attempts }
    })
    .addEdge(START, 'batch_score').addEdge('batch_score', 'tailor').addEdge('tailor', END).compile()
  const result = await graph.invoke({})
  const selected = [...(result.scored?.relevance ?? [])].filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 24)
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
    return latest(b) - latest(a)
  }).map(entry => {
    const cited = itemFor(entry.evidence, category)
    return { text: input.restoreText?.(entry.text) ?? entry.text, citations: cited.map(item => ({ evidenceId: item.id, revision: item.revision })), rationale: entry.rationale }
  })
  const content = draftContentSchema.parse({
    education: buildParagraphs(result.tailored!.education, 'education'), experience: buildParagraphs(result.tailored!.experience, 'experience'), projects: buildParagraphs(result.tailored!.projects, 'projects'),
    skills: result.tailored!.skills.map(entry => { const cited = itemFor(entry.evidence, 'skills'); if (!cited.some(item => String(item.snapshot.name).toLowerCase() === entry.name.toLowerCase())) throw new Error('Generated skill is not present in cited profile evidence.'); return { name: entry.name, citations: cited.map(item => ({ evidenceId: item.id, revision: item.revision })), rationale: entry.rationale } }),
    certificates: buildParagraphs(result.tailored!.certificates, 'certificates')
  })
  const evidenceIds = new Set(Object.values(content).flatMap(section => section.flatMap(item => item.citations.map(c => c.evidenceId))))
  const evidence = input.items.filter(item => evidenceIds.has(item.id)).map(item => ({ evidenceId: item.id, revision: item.revision, snapshot: item.snapshot }))
  return { draft: { ...input.identity, status: 'unverified', approved: false, content, evidence, progress: 'Draft generated; automated verification and human approval have not run.', attempts: result.attempts ?? 0 }, attempts: result.attempts ?? 0 }
}
