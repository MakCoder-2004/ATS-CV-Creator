import { StateGraph, Annotation, START, END, type BaseCheckpointSaver } from '@langchain/langgraph'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { draftContentSchema, type DraftRevision } from '../shared/draft'

const scoredSchema = z.object({ relevance: z.array(z.object({ index: z.number().int().nonnegative(), score: z.number().min(0).max(1), rationale: z.string().min(1).max(500) }).strict()) }).strict()
const tailoredSchema = z.object({ education: z.array(z.object({ text: z.string().trim().min(1).max(3000), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().trim().min(1).max(500) }).strict()), experience: z.array(z.object({ text: z.string().trim().min(1).max(3000), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().trim().min(1).max(500) }).strict()), projects: z.array(z.object({ text: z.string().trim().min(1).max(3000), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().trim().min(1).max(500) }).strict()), skills: z.array(z.object({ name: z.string().trim().min(1).max(160), evidence: z.array(z.number().int().nonnegative()).min(1), rationale: z.string().trim().min(1).max(500) }).strict()) })

export class CitationValidationError extends Error { constructor(readonly finding: 'foreign-citation' | 'missing-citation') { super(finding) } }
export class IncompatibleGenerationCheckpointError extends Error { constructor() { super('The saved generation checkpoint contains incompatible draft content. No provider request was sent; review outgoing data and start a fresh authorized generation.') } }

export type GenerationItem = { id: string; revision: number; category: 'education' | 'experience' | 'projects' | 'skills' | 'certificates'; snapshot: Record<string, unknown>; text: string; chronology?: string; parentId?: string }
const WORD_BUDGETS = { 1: { education: 105, experience: 300, projects: 135, skills: 100, certificates: 55 }, 2: { education: 190, experience: 570, projects: 260, skills: 180, certificates: 100 } } as const
const BULLET_LIMITS = { 1: { experience: 3, projects: 2 }, 2: { experience: 4, projects: 3 } } as const
const splitBullets = (text: string) => text.split(/\r?\n+/).map(line => line.trim().replace(/^(?:[•●▪◦‣*-]|\d+[.)])\s*/, '').trim()).filter(Boolean)
function parentGroups(items: GenerationItem[], selected: Array<{ index: number }>, category: 'experience' | 'projects') {
  const groups = new Map<string, number[]>()
  for (const { index } of selected) {
    const item = items[index]
    if (item.category !== category) continue
    const parent = item.parentId ?? item.id
    groups.set(parent, [...(groups.get(parent) ?? []), index])
  }
  return [...groups.values()]
}
function mergeParentEntries(entries: Array<{ text: string; evidence: number[]; rationale: string }>, groups: number[][]) {
  let valid = true
  for (const entry of entries) if (!groups.some(group => entry.evidence.length > 0 && entry.evidence.every(index => group.includes(index)))) valid = false
  const merged = groups.flatMap(group => {
    const matching = entries.filter(entry => entry.evidence.length > 0 && entry.evidence.every(index => group.includes(index)))
    if (!matching.length) return []
    return [{ text: [...new Set(matching.flatMap(entry => splitBullets(entry.text)))].join('\n'), evidence: [...new Set(matching.flatMap(entry => entry.evidence))], rationale: matching.map(entry => entry.rationale).join(' ').slice(0, 500) }]
  })
  return { entries: merged, valid }
}
function createTailoredValidator(input: { items: GenerationItem[]; identity: { lockedFields: { experience: Array<{ evidenceId: string; title: string; organization: string }>; projects: Array<{ evidenceId: string; name: string }> } }; target: 1 | 2; restore: (text: string) => string }, selected: Array<GenerationItem & { index: number; rationale: string }>) {
  const categories = ['education', 'experience', 'projects', 'skills'] as const
  const allowed = Object.fromEntries(categories.map(category => [category, selected.filter(item => item.category === category).map(item => item.index)])) as Record<typeof categories[number], number[]>
  const roleGroups = parentGroups(input.items, selected, 'experience'), projectGroups = parentGroups(input.items, selected, 'projects')
  const parentFor = (category: 'experience' | 'projects', group: number[]) => {
    const id = input.items[group[0]]?.parentId ?? input.items[group[0]]?.id
    if (category === 'experience') { const parent = input.identity.lockedFields.experience.find(item => item.evidenceId === id); return parent ? { title: parent.title, organization: parent.organization } : undefined }
    const parent = input.identity.lockedFields.projects.find(item => item.evidenceId === id)
    return parent ? { title: parent.name, organization: '' } : undefined
  }
  const validate = (value: z.infer<typeof tailoredSchema>) => {
    const roleEntries = mergeParentEntries(value.experience, roleGroups), projectEntries = mergeParentEntries(value.projects, projectGroups)
    const normalized = { ...value, experience: roleEntries.entries, projects: projectEntries.entries }
    const rawAllowed = categories.every(category => value[category].every(entry => entry.evidence.every(index => allowed[category].includes(index)))) && roleEntries.valid && projectEntries.valid
    const groupedParents = roleGroups.every((group, index) => { const entry = normalized.experience[index]; return !!entry && entry.evidence.every(evidenceIndex => group.includes(evidenceIndex)) }) && projectGroups.every((group, index) => { const entry = normalized.projects[index]; return !!entry && entry.evidence.every(evidenceIndex => group.includes(evidenceIndex)) }) && normalized.experience.length === roleGroups.length && normalized.projects.length === projectGroups.length
    const repeatsHeading = (bullet: string, heading: ReturnType<typeof parentFor>) => [heading?.title, heading?.organization].filter((label): label is string => Boolean(label)).some(label => { const prefix = bullet.slice(0, label.length); return prefix.toLocaleLowerCase() === label.toLocaleLowerCase() && (bullet.length === label.length || !/[\p{L}\p{N}]/u.test(bullet[label.length])) })
    const format = (['experience', 'projects'] as const).every(category => normalized[category].every((entry, index) => { const bullets = splitBullets(entry.text), restoredBullets = splitBullets(input.restore(entry.text)), cap = BULLET_LIMITS[input.target][category], group = (category === 'experience' ? roleGroups : projectGroups)[index], heading = parentFor(category, group); return bullets.length > 0 && bullets.length <= cap && restoredBullets.length === bullets.length && bullets.every(bullet => bullet.length <= 300 && !repeatsHeading(bullet, heading)) && restoredBullets.every(bullet => bullet.length <= 300 && !repeatsHeading(bullet, heading)) }))
    return { value: normalized, valid: rawAllowed && groupedParents && format }
  }
  return { allowed, roleGroups, projectGroups, validate }
}
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
  const ranked = [...relevance].filter(item => item.score > 0 && items[item.index]?.category !== 'certificates').sort((a, b) => b.score - a.score || a.index - b.index)
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
export async function runSourceLinkedGraph(input: { job: unknown; analysis: unknown; items: GenerationItem[]; savedSkillNames?: string[]; pageTarget?: 1 | 2; sourceJobRevision?: string | number; call(prompt: string, schema: z.ZodTypeAny): Promise<{ value: unknown; attempts: number }>; onProgress?: (progress: string, step?: 'parse-posting' | 'score-evidence' | 'select-content' | 'tailor-paragraphs' | 'verify-claims' | 'check-document', completedSteps?: Array<'parse-posting' | 'score-evidence' | 'select-content' | 'tailor-paragraphs' | 'verify-claims' | 'check-document'>) => void; checkpointer?: BaseCheckpointSaver; threadId?: string; resume?: boolean; identity: { id: string; jobId: string; revision: number; createdAt: string; lockedFields: { fullName: string; headline?: string; experience: Array<{ evidenceId: string; title: string; organization: string; startDate?: string; endDate?: string }>; education: Array<{ evidenceId: string; title: string; institution?: string; startDate?: string; endDate?: string }>; projects: Array<{ evidenceId: string; name: string }>; certificates: Array<{ evidenceId: string; title: string; issuer?: string; year?: number }> } }; restoreText?: (text: string) => string }): Promise<{ draft: DraftRevision; attempts: number; semanticPairs: Array<{ section: keyof DraftRevision['content']; itemPath: string; rewritten: string; evidence: string[] }> }> {
  const restore = (text: string) => input.restoreText?.(text) ?? text
  const completedSteps: Array<'parse-posting' | 'score-evidence' | 'select-content' | 'tailor-paragraphs' | 'verify-claims' | 'check-document'> = ['parse-posting']
  const mark = (step: typeof completedSteps[number], progress: string) => { if (!completedSteps.includes(step)) completedSteps.push(step); input.onProgress?.(progress, step, [...completedSteps]) }
  const State = Annotation.Root({ scored: Annotation<z.infer<typeof scoredSchema> | undefined>(), tailored: Annotation<z.infer<typeof tailoredSchema> | undefined>(), attempts: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }) })
  const graph = new StateGraph(State)
    .addNode('batch_score', async () => {
      input.onProgress?.('Scoring eligible evidence against the parsed job.', 'score-evidence', [...completedSteps])
      const scoreableIndices = input.items.flatMap((item, index) => item.category === 'certificates' ? [] : [index])
      const response = await input.call(`Score these numbered eligible evidence items for relevance to the parsed job. Return one score and an inclusion rationale per item. Do not infer qualifications.\n${JSON.stringify({ job: input.job, analysis: input.analysis, items: scoreableIndices.map(index => ({ index, category: input.items[index].category, text: input.items[index].text })) })}`, scoredSchema)
      const scored = scoredSchema.parse(response.value)
      const indices = scored.relevance.map(item => item.index)
      if (indices.some(index => !scoreableIndices.includes(index)) || new Set(indices).size !== indices.length || indices.length !== scoreableIndices.length) throw new Error('Batch scoring returned missing, duplicate, or foreign evidence indexes.')
      mark('score-evidence', 'Evidence relevance scoring completed.')
      return { scored, attempts: response.attempts }
    })
    .addNode('tailor', async state => {
      const order = selectWithinPageBudget(input.items, state.scored?.relevance ?? [], input.pageTarget ?? 1)
      mark('select-content', 'Relevant content selected within the page budget.')
      if (!order.length) throw new Error('No authorized profile evidence fits the selected page budget.')
      const selected = order.map(x => ({ ...input.items[x.index], index: x.index, rationale: x.rationale })).filter(x => x.id)
      input.onProgress?.('Tailoring selected content to the job posting.', 'tailor-paragraphs', [...completedSteps])
      const validator = createTailoredValidator({ items: input.items, identity: input.identity, target: input.pageTarget ?? 1, restore }, selected)
      const { allowed, roleGroups, projectGroups } = validator
      const prompt = `Write concise, content-only CV wording from selected evidence. Return education and skill items as concise entries. Return exactly one experience item per experienceGroups entry and exactly one project item per projectGroups entry, in the given order. Each role/project text is newline-separated bullets; at most ${BULLET_LIMITS[input.pageTarget ?? 1].experience} role bullets and ${BULLET_LIMITS[input.pageTarget ?? 1].projects} project bullets, each <=300 characters. Do not repeat the supplied historical title or employer at the beginning of a bullet; those are rendered separately. Cite only evidence indexes belonging to that exact parent group. Other sections cite only indexes from their own category. Preserve factual meaning, ownership, scope and certainty; do not infer or add facts. Omit certificates and all introductory headline/summary prose. Return JSON matching the requested schema only.\n${JSON.stringify({ job: input.job, analysis: input.analysis, allowedEvidenceBySection: allowed, experienceGroups: roleGroups.map((indexes, index) => ({ group: index, indexes, sources: indexes.map(sourceIndex => ({ index: sourceIndex, text: input.items[sourceIndex].text })) })), projectGroups: projectGroups.map((indexes, index) => ({ group: index, indexes, sources: indexes.map(sourceIndex => ({ index: sourceIndex, text: input.items[sourceIndex].text })) })), selected: selected.map(({ index, category, text }) => ({ index, category, text })) })}`
      const request = async (extra: string) => input.call(`${prompt}${extra}`, tailoredSchema)
      let response = await request('')
      let validation = validator.validate(tailoredSchema.parse(response.value))
      let attempts = response.attempts
      if (!validation.valid) {
        input.onProgress?.('Retrying draft wording with parent-specific citations and concise bullet limits.')
        response = await request('\nCorrection: return exactly one item per supplied parent, cite only its listed indexes, use no repeated title/employer prefix, and obey every bullet count and length limit. Do not truncate or omit unsupported facts silently.')
        validation = validator.validate(tailoredSchema.parse(response.value))
        attempts += response.attempts
      }
      if (!validation.valid) throw new CitationValidationError('foreign-citation')
      const tailored = validation.value
      mark('tailor-paragraphs', 'Tailored content generated.')
      return { tailored, attempts }
    })
    .addEdge(START, 'batch_score').addEdge('batch_score', 'tailor').addEdge('tailor', END)
  const compiled = graph.compile({ checkpointer: input.checkpointer })
  const result = await compiled.invoke(input.resume ? null : {}, input.threadId ? { configurable: { thread_id: input.threadId } } : undefined)
  const selected = selectWithinPageBudget(input.items, result.scored?.relevance ?? [], input.pageTarget ?? 1)
  if (!selected.length) throw new Error('No eligible profile evidence was selected for this posting.')
  const selectedItems = selected.map(item => ({ ...input.items[item.index], index: item.index, rationale: item.rationale }))
  const validator = createTailoredValidator({ items: input.items, identity: input.identity, target: input.pageTarget ?? 1, restore }, selectedItems)
  let tailored: z.infer<typeof tailoredSchema>
  try { tailored = tailoredSchema.parse(result.tailored) }
  catch { if (input.resume) throw new IncompatibleGenerationCheckpointError(); throw new CitationValidationError('missing-citation') }
  const checkpointValidation = validator.validate(tailored)
  if (!checkpointValidation.valid) { if (input.resume) throw new IncompatibleGenerationCheckpointError(); throw new CitationValidationError('foreign-citation') }
  tailored = checkpointValidation.value
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
  // Legacy top-level narrative fields are stripped by the schema; restored content is revalidated above.
  const content = draftContentSchema.parse({
    education: buildParagraphs(tailored.education, 'education'), experience: buildParagraphs(tailored.experience, 'experience'), projects: buildParagraphs(tailored.projects, 'projects'),
    skills: tailored.skills.map(entry => { const cited = itemFor(entry.evidence, 'skills'); return { name: restore(entry.name), citations: cited.map(item => ({ evidenceId: item.id, revision: item.revision })), rationale: restore(entry.rationale) } }), certificates: []
  })
  const evidenceIds = new Set(Object.values(content).flatMap(section => section.flatMap(item => item.citations.map(c => c.evidenceId))))
  const evidence = input.items.filter(item => evidenceIds.has(item.id)).map(item => ({ evidenceId: item.id, revision: item.revision, snapshot: item.snapshot }))
  const semanticPairs: Array<{ section: keyof DraftRevision['content']; itemPath: string; rewritten: string; evidence: string[] }> = []
  for (const section of ['education', 'experience', 'projects', 'skills'] as const) {
    const generated = tailored[section]
    generated.forEach((entry, index) => {
      const rewritten = 'text' in entry ? entry.text : entry.name
      const cited = itemFor(entry.evidence, section)
      const citationIds = cited.map(item => item.id).sort()
      const draftIndex = content[section].findIndex(item => [...item.citations.map(citation => citation.evidenceId)].sort().join('|') === citationIds.join('|'))
      semanticPairs.push({ section, itemPath: `${section}[${draftIndex >= 0 ? draftIndex : index}]`, rewritten, evidence: cited.map(item => item.text) })
    })
  }
  const analysis = input.analysis as { tools?: unknown; keywords?: unknown }
  const key = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase()
  const terms = [...new Set((Array.isArray(analysis?.tools) ? analysis.tools : []).filter((term): term is string => typeof term === 'string').map(term => restore(term).trim()).filter(term => term.length > 0 && term.length <= 160).map(term => [key(term), term] as const).filter(([termKey], index, all) => all.findIndex(([candidate]) => candidate === termKey) === index).map(([, term]) => term))]
  const inventory = new Set((input.savedSkillNames ?? input.items.filter(item => item.category === 'skills').map(item => String(item.snapshot.name ?? ''))).map(key))
  const draftedSkills = new Set(content.skills.map(skill => key(skill.name)))
  const suggestedSkills = terms.filter(term => !inventory.has(key(term)) && !draftedSkills.has(key(term))).slice(0, 100).map(name => ({ id: randomUUID(), name, postingTerm: name, sourceJobRevision: input.sourceJobRevision ?? '' , status: 'pending' as const }))
  return { draft: { ...input.identity, pageTarget: input.pageTarget ?? 1, status: 'unverified', approved: false, content, suggestedSkills, evidence, progress: `Draft generated for a ${input.pageTarget ?? 1}-page target; automated verification and human approval have not run.`, attempts: result.attempts ?? 0 }, attempts: result.attempts ?? 0, semanticPairs }
}
