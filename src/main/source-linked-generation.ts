import { StateGraph, Annotation, START, END, type BaseCheckpointSaver } from '@langchain/langgraph'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { draftContentSchema, type DraftRevision } from '../shared/draft'

const scoredSchema = z.object({ relevance: z.array(z.object({ index: z.number().int().nonnegative(), score: z.number().min(0).max(1), rationale: z.string().min(1).max(500) }).strict()) }).strict()
const tailoredSchema = z.object({ headline: z.string().trim().min(1).max(160), summary: z.object({ text: z.string().trim().min(1).max(1200), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().min(1) }).strict(), education: z.array(z.object({ text: z.string(), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().min(1) }).strict()), experience: z.array(z.object({ text: z.string(), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().min(1) }).strict()), projects: z.array(z.object({ text: z.string(), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().min(1) }).strict()), skills: z.array(z.object({ name: z.string(), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().min(1) }).strict()), certificates: z.array(z.object({ text: z.string(), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().min(1) }).strict()) }).strict()

export class CitationValidationError extends Error { constructor(readonly finding: 'foreign-citation' | 'missing-citation') { super(finding) } }
export class LegacyNarrativeCheckpointError extends Error { constructor() { super('This saved generation checkpoint predates the narrative fields. Start a fresh authorized generation.') } }

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
export async function runSourceLinkedGraph(input: { job: unknown; analysis: unknown; items: GenerationItem[]; savedSkillNames?: string[]; pageTarget?: 1 | 2; sourceJobRevision?: string | number; call(prompt: string, schema: z.ZodTypeAny): Promise<{ value: unknown; attempts: number }>; onProgress?: (progress: string, step?: 'parse-posting' | 'score-evidence' | 'select-content' | 'tailor-paragraphs' | 'verify-claims' | 'check-document', completedSteps?: Array<'parse-posting' | 'score-evidence' | 'select-content' | 'tailor-paragraphs' | 'verify-claims' | 'check-document'>) => void; checkpointer?: BaseCheckpointSaver; threadId?: string; resume?: boolean; identity: { id: string; jobId: string; revision: number; createdAt: string; lockedFields: { fullName: string; headline?: string; experience: Array<{ evidenceId: string; title: string; organization: string; startDate?: string; endDate?: string }>; education: Array<{ evidenceId: string; title: string; institution?: string; startDate?: string; endDate?: string }>; projects: Array<{ evidenceId: string; name: string }>; certificates: Array<{ evidenceId: string; title: string; issuer?: string; year?: number }> } }; restoreText?: (text: string) => string }): Promise<{ draft: DraftRevision; attempts: number; semanticPairs: Array<{ section: keyof DraftRevision['content'] | 'summary'; itemPath: string; rewritten: string; evidence: string[] }> }> {
  const restore = (text: string) => input.restoreText?.(text) ?? text
  const completedSteps: Array<'parse-posting' | 'score-evidence' | 'select-content' | 'tailor-paragraphs' | 'verify-claims' | 'check-document'> = ['parse-posting']
  const mark = (step: typeof completedSteps[number], progress: string) => { if (!completedSteps.includes(step)) completedSteps.push(step); input.onProgress?.(progress, step, [...completedSteps]) }
  const State = Annotation.Root({ scored: Annotation<z.infer<typeof scoredSchema> | undefined>(), tailored: Annotation<z.infer<typeof tailoredSchema> | undefined>(), attempts: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }) })
  const graph = new StateGraph(State)
    .addNode('batch_score', async () => {
      input.onProgress?.('Scoring eligible evidence against the parsed job.', 'score-evidence', [...completedSteps])
      const response = await input.call(`Score these numbered eligible evidence items for relevance to the parsed job. Return one score and an inclusion rationale per item. Do not infer qualifications.\n${JSON.stringify({ job: input.job, analysis: input.analysis, items: input.items.map((item, index) => ({ index, category: item.category, text: item.text })) })}`, scoredSchema)
      const scored = scoredSchema.parse(response.value)
      const indices = scored.relevance.map(item => item.index)
      if (indices.some(index => index >= input.items.length) || new Set(indices).size !== indices.length || indices.length !== input.items.length) throw new Error('Batch scoring returned missing, duplicate, or foreign evidence indexes.')
      mark('score-evidence', 'Evidence relevance scoring completed.')
      return { scored, attempts: response.attempts }
    })
    .addNode('tailor', async state => {
      const order = selectWithinPageBudget(input.items, state.scored?.relevance ?? [], input.pageTarget ?? 1)
      mark('select-content', 'Relevant content selected within the page budget.')
      if (!order.length) throw new Error('No authorized profile evidence fits the selected page budget.')
      const selected = order.map(x => ({ ...input.items[x.index], index: x.index, rationale: x.rationale })).filter(x => x.id)
      input.onProgress?.('Tailoring selected content to the job posting.', 'tailor-paragraphs', [...completedSteps])
      const categories = ['education', 'experience', 'projects', 'skills', 'certificates'] as const
      const allowed = Object.fromEntries(categories.map(category => [category, selected.filter(item => item.category === category).map(item => item.index)])) as Record<typeof categories[number], number[]>
      const prompt = `Write conservative, concise tailored CV wording using only selected evidence. Incorporate relevant posting keywords into each role or project description only when that source supports them; preserve each role/project’s own technologies and facts. Produce a target-role headline without seniority inflation (for example AI/ML Developer Level II may become AI/ML Engineer, not Senior Engineer) and a short evidence-grounded summary which may cite across selected categories. Historical titles, employers, institutions, project names and dates must remain unchanged. Each content section may cite ONLY indexes from its own section; every item needs a citation. Do not infer absent qualifications or strengthen responsibility, scope, or certainty. Return only requested JSON.\n${JSON.stringify({ job: input.job, analysis: input.analysis, allowedEvidenceBySection: allowed, selected: selected.map(({ index, category, text }) => ({ index, category, text })) })}`
      const validCitations = (value: z.infer<typeof tailoredSchema>) => categories.every(category => value[category].every(entry => entry.evidence.every(index => allowed[category].includes(index)))) && value.summary.evidence.every(index => selected.some(item => item.index === index))
      let response = await input.call(prompt, tailoredSchema)
      let tailored = tailoredSchema.parse(response.value)
      let attempts = response.attempts
      if (!validCitations(tailored)) {
        input.onProgress?.('Retrying draft wording with category-specific citation constraints.')
        response = await input.call(`${prompt}\nImportant: citation indexes must come from allowedEvidenceBySection for the corresponding output section. Do not cross-cite a role in the skills section.`, tailoredSchema)
        tailored = tailoredSchema.parse(response.value)
        attempts += response.attempts
      }
      if (!validCitations(tailored)) throw new CitationValidationError('foreign-citation')
      mark('tailor-paragraphs', 'Tailored narrative and paragraphs generated.')
      return { tailored, attempts }
    })
    .addEdge(START, 'batch_score').addEdge('batch_score', 'tailor').addEdge('tailor', END)
  const compiled = graph.compile({ checkpointer: input.checkpointer })
  const result = await compiled.invoke(input.resume ? null : {}, input.threadId ? { configurable: { thread_id: input.threadId } } : undefined)
  const selected = selectWithinPageBudget(input.items, result.scored?.relevance ?? [], input.pageTarget ?? 1)
  if (!selected.length) throw new Error('No eligible profile evidence was selected for this posting.')
  const selectedIndices = new Set(selected.map(x => x.index))
  const itemFor = (indices: number[], category: GenerationItem['category']) => indices.map(index => {
    const item = input.items[index]
    if (!item || !selectedIndices.has(index) || item.category !== category) throw new CitationValidationError('foreign-citation')
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
    return { text: restore(entry.text), citations: cited.map(item => ({ evidenceId: item.id, revision: item.revision })), rationale: restore(entry.rationale) }
  })
  // Summary may cite selected evidence from multiple categories.
  if (input.resume && (!result.tailored?.headline || !result.tailored.summary)) throw new LegacyNarrativeCheckpointError()
  const narrative = result.tailored!.summary
  const summaryCited = narrative.evidence.map(index => { const item = input.items[index]; if (!item || !selectedIndices.has(index)) throw new CitationValidationError('foreign-citation'); return item })
  const tailoring = { headline: restore(result.tailored!.headline), summary: { text: restore(narrative.text), citations: summaryCited.map(item => ({ evidenceId: item.id, revision: item.revision })), rationale: restore(narrative.rationale) } }
  const content = draftContentSchema.parse({
    education: buildParagraphs(result.tailored!.education, 'education'), experience: buildParagraphs(result.tailored!.experience, 'experience'), projects: buildParagraphs(result.tailored!.projects, 'projects'),
    skills: result.tailored!.skills.map(entry => { const cited = itemFor(entry.evidence, 'skills'); return { name: restore(entry.name), citations: cited.map(item => ({ evidenceId: item.id, revision: item.revision })), rationale: restore(entry.rationale) } }),
    certificates: buildParagraphs(result.tailored!.certificates, 'certificates')
  })
  const evidenceIds = new Set([...Object.values(content).flatMap(section => section.flatMap(item => item.citations.map(c => c.evidenceId))), ...tailoring.summary.citations.map(citation => citation.evidenceId)])
  const evidence = input.items.filter(item => evidenceIds.has(item.id)).map(item => ({ evidenceId: item.id, revision: item.revision, snapshot: item.snapshot }))
  const semanticPairs: Array<{ section: keyof DraftRevision['content'] | 'summary'; itemPath: string; rewritten: string; evidence: string[] }> = []
  for (const section of ['education', 'experience', 'projects', 'skills', 'certificates'] as const) {
    const generated = result.tailored![section]
    generated.forEach((entry, index) => {
      const rewritten = 'text' in entry ? entry.text : entry.name
      const cited = itemFor(entry.evidence, section)
      const citationIds = cited.map(item => item.id).sort()
      const draftIndex = content[section].findIndex(item => [...item.citations.map(citation => citation.evidenceId)].sort().join('|') === citationIds.join('|'))
      semanticPairs.push({ section, itemPath: `${section}[${draftIndex >= 0 ? draftIndex : index}]`, rewritten, evidence: cited.map(item => item.text) })
    })
  }
  semanticPairs.push({ section: 'summary', itemPath: 'summary[0]', rewritten: narrative.text, evidence: summaryCited.map(item => item.text) })
  const analysis = input.analysis as { tools?: unknown; keywords?: unknown }
  const key = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase()
  const terms = [...new Set((Array.isArray(analysis?.tools) ? analysis.tools : []).filter((term): term is string => typeof term === 'string').map(term => restore(term).trim()).filter(term => term.length > 0 && term.length <= 160).map(term => [key(term), term] as const).filter(([termKey], index, all) => all.findIndex(([candidate]) => candidate === termKey) === index).map(([, term]) => term))]
  const inventory = new Set((input.savedSkillNames ?? input.items.filter(item => item.category === 'skills').map(item => String(item.snapshot.name ?? ''))).map(key))
  const draftedSkills = new Set(content.skills.map(skill => key(skill.name)))
  const suggestedSkills = terms.filter(term => !inventory.has(key(term)) && !draftedSkills.has(key(term))).slice(0, 100).map(name => ({ id: randomUUID(), name, postingTerm: name, sourceJobRevision: input.sourceJobRevision ?? '' , status: 'pending' as const }))
  return { draft: { ...input.identity, pageTarget: input.pageTarget ?? 1, status: 'unverified', approved: false, content, tailoring, suggestedSkills, evidence, progress: `Draft generated for a ${input.pageTarget ?? 1}-page target; automated verification and human approval have not run.`, attempts: result.attempts ?? 0 }, attempts: result.attempts ?? 0, semanticPairs }
}
