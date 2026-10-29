import { z } from 'zod'
import { coverLetterRevisionSchema } from './cover-letter'
import { escapeLatex } from './latex'

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const coverLetterTemplateIdentitySchema = z.object({
  revision: z.string().trim().min(1).max(80),
  manifestSha256: digestSchema,
}).strict()
export type CoverLetterTemplateIdentity = z.infer<typeof coverLetterTemplateIdentitySchema>

const supportedLetterText = (value: string) => !/[\u0000-\u001f\u007f-\u009f\u200B-\u200F\u202A-\u202E\u2066-\u2069]/u.test(value) && !/[^\u0020-\u007e\u00a0-\u024f\u0300-\u036f\u2013\u2014\u2018\u2019\u201c\u201d\u2026]/u.test(value)
const printableText = (max: number) => z.string().trim().min(1).max(max).refine(supportedLetterText, 'Text contains unsupported characters.').transform(value => value.normalize('NFC'))
const printableEmail = z.string().email().max(254).refine(supportedLetterText, 'Email contains unsupported characters.').transform(value => value.normalize('NFC'))
export const canonicalCoverLetterSchema = z.object({
  version: z.literal(1),
  template: coverLetterTemplateIdentitySchema,
  jobId: z.string().uuid(),
  sourceRevisionId: z.string().uuid(),
  revision: z.number().int().positive(),
  date: printableText(80),
  subject: printableText(300),
  name: printableText(160),
  contact: z.object({ email: printableEmail.optional(), phone: printableText(64).optional(), location: printableText(160).optional() }).strict(),
  recipient: printableText(200).optional(),
  greeting: printableText(220),
  paragraphs: z.array(printableText(3000)).min(1).max(8),
  signature: printableText(160),
}).strict().superRefine((letter, ctx) => {
  const expected = letter.recipient ? `Dear ${letter.recipient},` : 'Dear Hiring Manager,'
  if (letter.greeting !== expected) ctx.addIssue({ code: 'custom', path: ['greeting'], message: 'Greeting must match the selected recipient.' })
})
export type CanonicalCoverLetter = z.infer<typeof canonicalCoverLetterSchema>

export const coverLetterContactSchema = z.object({ fullName: printableText(160), email: printableEmail.optional(), phone: printableText(64).optional(), location: printableText(160).optional() }).strict()
export type CoverLetterContact = z.infer<typeof coverLetterContactSchema>

export function projectCoverLetter(revisionInput: unknown, contactInput: unknown, templateInput: unknown): CanonicalCoverLetter {
  const revision = coverLetterRevisionSchema.parse(revisionInput)
  const contact = coverLetterContactSchema.parse(contactInput)
  const template = coverLetterTemplateIdentitySchema.parse(templateInput)
  return canonicalCoverLetterSchema.parse({
    version: 1, template, jobId: revision.jobId, sourceRevisionId: revision.id, revision: revision.revision,
    date: revision.date, subject: revision.subject, name: contact.fullName,
    contact: { ...(contact.email ? { email: contact.email } : {}), ...(contact.phone ? { phone: contact.phone } : {}), ...(contact.location ? { location: contact.location } : {}) },
    ...(revision.recipient ? { recipient: revision.recipient } : {}),
    greeting: revision.recipient ? `Dear ${revision.recipient},` : 'Dear Hiring Manager,',
    paragraphs: revision.paragraphs.map(paragraph => paragraph.text), signature: contact.fullName,
  })
}

export function renderCoverLetterTex(input: unknown): string {
  const letter = canonicalCoverLetterSchema.parse(input)
  const contact = [letter.contact.email, letter.contact.phone, letter.contact.location].filter((value): value is string => Boolean(value)).join(' · ')
  const body = letter.paragraphs.map(escapeLatex).join('\\par\n')
  return [
    `\\newcommand{\\LetterName}{${escapeLatex(letter.name)}}`,
    `\\newcommand{\\LetterContact}{${escapeLatex(contact)}}`,
    `\\newcommand{\\LetterDate}{${escapeLatex(letter.date)}}`,
    `\\newcommand{\\LetterSubject}{${escapeLatex(letter.subject)}}`,
    `\\newcommand{\\LetterGreeting}{${escapeLatex(letter.greeting)}}`,
    `\\newcommand{\\LetterBody}{${body}}`,
    `\\newcommand{\\LetterSignature}{${escapeLatex(letter.signature)}}`,
    '',
  ].join('\n')
}
