import { z } from 'zod'
import { coverLetterModelResponseSchema } from '../shared/cover-letter'

export const scriptedCoverLetterModes = ['cover-letter-success', 'cover-letter-failure', 'cover-letter-delay', 'cover-letter-invalid'] as const
const modeSchema = z.enum(scriptedCoverLetterModes)
const sourceSchema = z.object({ ordinal: z.number().int().positive(), category: z.enum(['education', 'experience', 'project', 'skill']), heading: z.string().min(1).max(300), passage: z.string().min(1).max(5000), kind: z.enum(['employment', 'training']).optional() }).strict()

/** Synthetic transport response only. It does not create grants, measurements, revisions or approvals. */
export async function scriptedCoverLetterResponse(packaged: boolean, mode: string | undefined, prompt: string, signal: AbortSignal): Promise<string | null> {
  if (packaged || !modeSchema.safeParse(mode).success || !prompt.startsWith('Write one cover letter')) return null
  if (mode === 'cover-letter-failure') throw new Error('Synthetic cover-letter provider failure.')
  if (mode === 'cover-letter-invalid') return '{ invalid structured letter'
  if (mode === 'cover-letter-delay') await new Promise<void>((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(new Error('Synthetic cover-letter cancellation.')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve() }, 1500)
    if (signal.aborted) aborted()
    else signal.addEventListener('abort', aborted, { once: true })
  })
  const request = JSON.parse(prompt.slice(prompt.indexOf('{'))) as { sources?: unknown }
  const sources = z.array(sourceSchema).min(1).max(500).parse(request.sources)
  const source = sources.find(item => item.category === 'skill') ?? sources[0]
  const text = source.category === 'skill' ? `I use ${source.heading}.` : source.passage
  return JSON.stringify(coverLetterModelResponseSchema.parse({ paragraphs: [{ text, citations: [{ ordinal: source.ordinal }] }] }))
}
