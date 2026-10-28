import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { coverLetterAcknowledgmentMaterial, coverLetterModelResponseSchema, coverLetterRevisionSchema } from '../src/shared/cover-letter'

const id = () => randomUUID()
const source = { ordinal: 1, evidenceId: id(), revision: 2, parentId: id(), category: 'experience' as const, heading: 'Platform Engineer — Acme', passage: 'Built an internal deployment platform.' }
const paragraph = { id: id(), text: 'I built an internal deployment platform.', citations: [{ ordinal: 1 }] }
const letter = () => ({ id: id(), jobId: id(), parentRunId: id(), operationId: id(), cvRevisionId: id(), revision: 1, createdAt: new Date().toISOString(), bindings: { postingUpdatedAt: new Date().toISOString(), scopeHash: 'a'.repeat(64), modelHash: 'b'.repeat(64), sources: [source] }, date: '28 October 2026', subject: 'Application: Platform Engineer', paragraphs: [paragraph], findings: [], acknowledgments: {}, approved: false })

describe('cover letter contracts', () => {
  it('accepts a bounded response and refuses model-authored authority or unknown keys', () => {
    expect(coverLetterModelResponseSchema.safeParse({ paragraphs: [{ text: paragraph.text, citations: [{ ordinal: 1 }] }] }).success).toBe(true)
    expect(coverLetterModelResponseSchema.safeParse({ paragraphs: [{ text: paragraph.text, citations: [{ ordinal: 1 }], acknowledged: true }] }).success).toBe(false)
    expect(coverLetterModelResponseSchema.safeParse({ paragraphs: [{ text: paragraph.text, citations: [{ ordinal: 999 }] }] }).success).toBe(true)
  })
  it('requires every citation to resolve to bound evidence and preserves parent/category context', () => {
    const good = letter()
    expect(coverLetterRevisionSchema.safeParse(good).success).toBe(true)
    expect(coverLetterRevisionSchema.safeParse({ ...good, paragraphs: [{ ...paragraph, citations: [{ ordinal: 2 }] }] }).success).toBe(false)
    expect(coverLetterRevisionSchema.safeParse({ ...good, bindings: { ...good.bindings, sources: [{ ...source, parentId: undefined }] } }).success).toBe(true)
  })
  it('requires independent measured fit and all current paragraph acknowledgments for approval', () => {
    const value = letter()
    expect(coverLetterRevisionSchema.safeParse({ ...value, approved: true, approvedAt: new Date().toISOString() }).success).toBe(false)
    const sourceList = [source]
    expect(coverLetterAcknowledgmentMaterial(paragraph, sourceList)).toContain('Built an internal deployment platform.')
    expect(() => coverLetterAcknowledgmentMaterial({ ...paragraph, citations: [{ ordinal: 9 }] }, sourceList)).toThrow(/outside the authorized/)
  })
  it('fails closed when acknowledgment map names an absent paragraph', () => {
    const value = letter()
    expect(coverLetterRevisionSchema.safeParse({ ...value, acknowledgments: { [id()]: 'c'.repeat(64) } }).success).toBe(false)
  })
})
