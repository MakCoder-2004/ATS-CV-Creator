import { COVER_LETTER_WORD_BUDGET, coverLetterModelResponseSchema, coverLetterSourceSchema, type CoverLetterRevision, type CoverLetterSource } from '../shared/cover-letter'
import { prepareOutboundBundle, type ConsentSource, type OutboundBundle } from '../shared/outbound-consent'
import { experienceInputSchema, type ExperienceRecord } from '../shared/experience'

/** Parallel local and minimized views; identifiers are never serialized into the prompt. */
export function prepareCoverLetterSources(source: ConsentSource, bundle: OutboundBundle) {
  const localIdentifier = /\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/i
  if (localIdentifier.test(JSON.stringify(bundle.outgoing.job))) throw new Error('The minimized posting still contains a local identifier.')
  const local: CoverLetterSource[] = []
  const outgoing: Array<{ ordinal: number; category: CoverLetterSource['category']; heading: string; passage: string; kind?: ExperienceRecord['kind'] }> = []
  const experienceKinds: Record<string, ExperienceRecord['kind']> = {}
  const add = (id: string, revision: number, category: CoverLetterSource['category'], heading: string, passage: string, safeHeading: string, safePassage: string, parentId?: string, kind?: ExperienceRecord['kind']) => {
    if (local.length >= 500 || !passage.trim() || !safePassage.trim()) return
    const ordinal = local.length + 1
    local.push(coverLetterSourceSchema.parse({ ordinal, evidenceId: id, revision, category, heading, passage, ...(parentId ? { parentId } : {}) }))
    // Fail closed rather than silently extending the reviewed bundle or truncating factual context.
    if (safeHeading.length > 300 || safePassage.length > 5000 || localIdentifier.test(`${safeHeading} ${safePassage}`) || bundle.containsRestoredIdentifier([safeHeading, safePassage])) throw new Error('A letter source could not be minimized within its bounds.')
    outgoing.push({ ordinal, category, heading: safeHeading, passage: safePassage, ...(kind ? { kind } : {}) })
    if (kind) experienceKinds[id] = kind
  }
  source.profile.education.forEach((item, index) => {
    const safe = bundle.outgoing.profile.education[index]
    const passage = JSON.stringify({ title: item.title, institution: item.institution, field: item.field, description: item.description })
    add(item.id, item.revision, 'education', item.title, passage, safe.title, JSON.stringify(safe))
  })
  source.profile.experience.forEach((item, index) => {
    const safe = bundle.outgoing.profile.experience[index]
    const heading = `${item.title} — ${item.organization}`, safeHeading = `${safe.title} — ${safe.organization}`
    const kind = item.kind === undefined ? undefined : experienceInputSchema.shape.kind.parse(item.kind)
    add(item.id, item.revision, 'experience', heading, item.description, safeHeading, safe.description, undefined, kind)
    item.factualItems?.forEach((fact, at) => { if (fact.id && fact.revision) add(fact.id, fact.revision, 'experience', heading, fact.text, safeHeading, safe.evidence[at], item.id, kind) })
  })
  source.profile.projects.forEach((item, index) => {
    const safe = bundle.outgoing.profile.projects[index]
    add(item.id, item.revision, 'project', item.name, item.description, safe.name, safe.description)
    item.factualItems?.forEach((fact, at) => { if (fact.id && fact.revision) add(fact.id, fact.revision, 'project', item.name, fact.text, safe.name, safe.evidence[at], item.id) })
    item.technologies?.forEach((fact, at) => { if (fact.id && fact.revision) add(fact.id, fact.revision, 'project', item.name, fact.text, safe.name, safe.technologies[at], item.id) })
  })
  source.profile.skills.forEach((item, index) => {
    const safe = bundle.outgoing.profile.skills[index]
    add(item.id, item.revision, 'skill', item.name, JSON.stringify({ name: item.name, category: item.category, proficiency: item.proficiency, years: item.years }), safe.name, JSON.stringify(safe))
  })
  if (!local.length) throw new Error('No bounded authorized career facts are available for a cover letter.')
  return { local, outgoing, experienceKinds }
}

const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}%$€£+#]+/gu, ' ').trim()
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const hasTerm = (text: string, term: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`, 'iu').test(text)
class CoverLetterSupportError extends Error {
  constructor(message: string, readonly term: string) { super(message) }
}

function numbers(text: string) {
  const withoutTokens = text.replace(/\[\[[A-Z_]+\d+\]\]/g, '')
  const qualifier = '(?:(?:more\\s+than|less\\s+than|at\\s+least|up\\s+to|over|under|above|below|about|around|approximately|nearly|almost|roughly)\\s+)?'
  const unit = '(?:percent(?:age)?|USD|EUR|GBP|CAD|AUD|dollars?|euros?|pounds?|yen|CNY|INR|k|m|million|billion|thousand|hours?|days?|weeks?|months?|years?|users?|customers?|projects?|teams?|employees?|requests?|records?|items?|bytes?|MB|GB|TB|ms|seconds?|minutes?)'
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${qualifier}(?:[$€£]\\s*)?\\d+(?:[,.]\\d+)*(?:\\s*(?:%|${unit}\\b))?`, 'giu')
  return [...withoutTokens.matchAll(pattern)].map(m => normalize(m[0]))
}

/** Format, citation identity and privacy remain hard boundaries, even for a blocked draft. */
export function parseCoverLetterResponse(value: unknown, sources: ReturnType<typeof prepareCoverLetterSources>, bundle: OutboundBundle) {
  const response = coverLetterModelResponseSchema.parse(value)
  const ordinals = new Set(sources.outgoing.map(source => source.ordinal))
  const allowedTokens = new Set(JSON.stringify([sources.outgoing, bundle.outgoing.job]).match(/\[\[[^\]\r\n]+\]\]/g) ?? [])
  for (const paragraph of response.paragraphs) {
    if (paragraph.citations.some(citation => !ordinals.has(citation.ordinal))) throw new Error('A letter citation is outside the authorized source set.')
    if (bundle.containsRestoredIdentifier(paragraph.text) || /\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/i.test(paragraph.text) || (paragraph.text.match(/\[\[[^\]\r\n]+\]\]/g) ?? []).some(token => !allowedTokens.has(token))) throw new Error('The letter contains an unauthorized identifier.')
  }
  return response
}

/** Detectable factual issues block approval, not access to a private-safe editable draft. */
export function validateCoverLetterResponse(value: unknown, sources: ReturnType<typeof prepareCoverLetterSources>, bundle: OutboundBundle, postingTools: readonly string[]) {
  const response = parseCoverLetterResponse(value, sources, bundle)
  const terms = [...postingTools, ...bundle.outgoing.profile.skills.map(s => s.name), ...bundle.outgoing.profile.projects.flatMap(p => p.technologies), 'TypeScript', 'JavaScript', 'Python', 'Rust', 'Java', 'Kubernetes', 'Docker', 'React', 'AWS', 'Azure', 'SQL', 'C++', 'C#']
  for (const paragraph of response.paragraphs) {
    const cited = paragraph.citations.map(c => sources.outgoing.find(s => s.ordinal === c.ordinal))
    const support = cited.map(s => `${s!.heading} ${s!.passage}`).join('\n')
    const tokens = paragraph.text.match(/\[\[[^\]\r\n]+\]\]/g) ?? []
    if (tokens.some(t => !support.includes(t))) throw new Error('The letter attributes a fact to an uncited source.')
    const checkSupport = (text: string, passage: string) => {
      const allowed = new Set(numbers(passage))
      const number = numbers(text).find(n => !allowed.has(n))
      if (number) throw new CoverLetterSupportError('The letter contains an unsupported numeric expression.', number)
      const skill = terms.find(term => term.trim() && hasTerm(text, term) && !hasTerm(passage, term))
      if (skill) throw new CoverLetterSupportError('The letter contains a detectably unsupported skill.', skill)
    }
    checkSupport(paragraph.text, support)
    // An explicitly named role/project cannot borrow another role's quantities or technologies.
    for (const sentence of paragraph.text.split(/(?<=[.!?])\s+|[;\n]/u)) {
      const anchors = sources.outgoing.filter(s => s.category !== 'skill' && (sentence.includes(s.heading) || (s.heading.match(/\[\[[A-Z_]+\d+\]\]/g) ?? []).some(t => sentence.includes(t))))
      if (!anchors.length) continue
      const ordinals = new Set(anchors.map(s => s.ordinal))
      const anchored = cited.filter(s => ordinals.has(s!.ordinal))
      if (!anchored.length) throw new Error('A named source is not cited.')
      const anchoredSupport = anchored.map(s => `${s!.heading} ${s!.passage}`).join('\n')
      checkSupport(sentence, anchoredSupport)
      const normalizedSentence = normalize(sentence), normalizedSupport = normalize(anchoredSupport)
      for (const other of sources.outgoing.filter(s => !ordinals.has(s.ordinal))) {
        const words = normalize(other.passage).split(' ')
        for (let at = 0; at + 4 <= words.length; at++) {
          const phrase = words.slice(at, at + 4).join(' ')
          if (normalizedSentence.includes(phrase) && !normalizedSupport.includes(phrase)) throw new Error('The letter detectably attributes another source passage to this named role or project.')
        }
      }
    }
  }
  return response
}

/** Re-run the same detectable factual policy on local, restored wording and actual passages. */
export function checkLocalCoverLetter(letter: CoverLetterRevision, source: ConsentSource, postingTools: readonly string[]): CoverLetterRevision['findings'] {
  const bundle = prepareOutboundBundle(source)
  const prepared = prepareCoverLetterSources(source, bundle)
  const local = { ...prepared, outgoing: prepared.local.map(item => ({ ordinal: item.ordinal, category: item.category, heading: item.heading, passage: item.passage })) }
  const budget = letter.paragraphs.reduce((count, paragraph) => count + paragraph.text.trim().split(/\s+/u).length, 0) > COVER_LETTER_WORD_BUDGET
    ? [{ code: 'local-word-budget', message: 'Shorten the letter body to 400 words or fewer before approval.' }] : []
  return [...budget, ...letter.paragraphs.flatMap(paragraph => {
    try {
      validateCoverLetterResponse({ paragraphs: [{ text: paragraph.text, citations: paragraph.citations }] }, local, { ...bundle, containsRestoredIdentifier: () => false }, postingTools)
      // Re-minimize only for the named-parent policy: employer/project tokens retain the
      // same attribution anchors as generation. The raw pass above must run first so
      // scrubbing cannot conceal an unsupported number, date, skill or local identifier.
      validateCoverLetterResponse({ paragraphs: [{ text: bundle.minimizeIdentifiers(paragraph.text), citations: paragraph.citations }] }, prepared, bundle, postingTools)
      return []
    } catch (error) {
      const message = error instanceof Error && /^The letter |^A (?:letter citation|named source)/.test(error.message) ? error.message : 'The paragraph cannot be checked against its current source passages.'
      return [{ code: 'local-factual-check', paragraphId: paragraph.id, message: error instanceof CoverLetterSupportError ? `${message} Check “${error.term.slice(0, 160)}” against this paragraph's sources.` : message }]
    }
  })]
}
