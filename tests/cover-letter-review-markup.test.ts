import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ApplicationDocumentSelector } from '../src/renderer/ApplicationDocumentSelector'
import { CoverLetterRunOption } from '../src/renderer/CoverLetterRunOption'
import { CoverLetterReview } from '../src/renderer/CoverLetterReview'
import { advanceReviewVisit, canBeginParagraphEdit, canBeginRecipientEdit } from '../src/renderer/cover-letter-review-state'

const uid = (n: string) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`
const revision = {
  id: uid('1'), jobId: uid('2'), parentRunId: uid('3'), operationId: uid('4'), cvRevisionId: uid('5'), revision: 1, createdAt: '2026-10-28T00:00:00.000Z',
  bindings: { postingUpdatedAt: '2026-10-27T00:00:00.000Z', scopeHash: 'a'.repeat(64), modelHash: 'b'.repeat(64), sources: [{ ordinal: 1, evidenceId: uid('6'), revision: 1, category: 'experience' as const, heading: 'Platform engineering', passage: 'Built resilient & reliable services.' }] },
  date: 'October 28, 2026', subject: 'Platform Engineer', paragraphs: [{ id: uid('7'), text: 'Built resilient services.', citations: [{ ordinal: 1 }] }], findings: [], acknowledgments: {}, approved: false,
}
const canonical = {
  version: 1 as const, template: { revision: 'letter-v1', manifestSha256: 'c'.repeat(64) }, jobId: revision.jobId, sourceRevisionId: revision.id, revision: 1,
  date: revision.date, subject: revision.subject, name: 'Ada Candidate', contact: { email: 'ada@example.test' }, greeting: 'Dear Hiring Manager,', paragraphs: ['Built resilient services.'], signature: 'Ada Candidate',
}
const handlers = {
  onSaveParagraph: async () => {}, onSaveRecipient: async () => {}, onAcknowledge: async () => {}, onCheck: async () => {}, onMeasureFit: async () => {}, onApprove: async () => {},
}
const renderReview = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(CoverLetterReview, { jobId: revision.jobId, sourceRevisionId: revision.cvRevisionId, letter: revision, canonical, checkStatus: 'issues', fitStatus: 'pending', readiness: { canApprove: false, reason: 'Resolve the listed issue.' }, message: 'The wording check found an issue.', busy: false, ...handlers, ...props } as never))

test('shows separate CV and cover letter selection with independent statuses', () => {
  const html = renderToStaticMarkup(createElement(ApplicationDocumentSelector, { selected: 'cover-letter', cvStatus: 'Approved', coverLetterStatus: 'Failed', onSelect: () => {} }))
  expect(html).toContain('aria-pressed="false">CV')
  expect(html).toContain('aria-pressed="true">Cover letter')
  expect(html).toContain('CV status: <strong>Approved</strong>')
  expect(html).toContain('Cover letter status: <strong>Failed</strong>')
})

test('offers an unchecked include option with persistent cost and privacy explanation', () => {
  const html = renderToStaticMarkup(createElement(CoverLetterRunOption, { checked: false, disabled: false, onChange: () => {} }))
  expect(html).toContain('Include a cover letter')
  expect(html).toContain('adds one model request')
  expect(html).toContain('not sent to Pi')
  expect(html).toContain('type="checkbox"')
  expect(html).not.toContain('checked=""')
  const authorized = renderToStaticMarkup(createElement(CoverLetterRunOption, { checked: true, disabled: true, authorizedPurpose: 'cv+cover-letter', onChange: () => {} }))
  expect(authorized).toContain('Authorized purpose: CV and cover letter')
  expect(authorized).toContain('fresh authorization')
  expect(authorized).toContain('disabled=""')
})

test('renders bound letter and source passages as escaped review-only content', () => {
  const html = renderReview({ letter: { ...revision, bindings: { ...revision.bindings, sources: [{ ...revision.bindings.sources[0], passage: '<script>not code</script> & source' }] } } })
  expect(html).toContain('October 28, 2026')
  expect(html).toContain('Platform Engineer')
  expect(html).toContain('Dear Hiring Manager,')
  expect(html).toContain('Built resilient services.')
  expect(html).toContain('&lt;script&gt;not code&lt;/script&gt; &amp; source')
  expect(html).not.toContain('<script>not code</script>')
  expect(html).toContain('Structured review only')
  expect(html).not.toContain(revision.id)
  expect(html).not.toContain(uid('6'))
  expect(html).not.toContain('ordinal')
  expect(html).not.toContain('evidenceId')
  expect(html).not.toContain('scopeHash')
  expect(html).not.toContain('modelHash')
  expect(html).not.toContain('approvalHash')
  expect(html).not.toContain('type="hidden"')
})

test('keeps an optional recipient field labeled, local-only, and escaped', () => {
  const html = renderReview()
  expect(html).toContain('Recipient name (optional)')
  expect(html).toContain('stays on this device and is not sent to Pi')
  const recipient = '<img src=x>'
  const revisionWithRecipient = { ...revision, recipient }
  const canonicalWithRecipient = { ...canonical, recipient, greeting: `Dear ${recipient},` }
  const escaped = renderReview({ letter: revisionWithRecipient, canonical: canonicalWithRecipient })
  expect(escaped).toContain('&lt;img src=x&gt;')
  expect(escaped).not.toContain('<img src=x>')
})

test('renders editable paragraph actions, current acknowledgment, and honest semantic limitation', () => {
  const html = renderReview({ letter: { ...revision, acknowledgments: { [revision.paragraphs[0].id]: 'd'.repeat(64) } } })
  expect(html).toContain('Edit paragraph 1')
  expect(html).toContain('Source reviewed')
  expect(renderReview()).toContain('Acknowledge sources for paragraph 1')
  expect(html).toContain('1 of 1 paragraphs acknowledged')
  expect(html).toContain('Automated checks cannot prove semantic truth')
})

test('preserves stale and unavailable state without hiding CV selection', () => {
  const html = renderReview({ sourceRevisionId: uid('8'), message: 'This cover letter is out of date.', readiness: { canApprove: false, reason: 'Review the current source.' } })
  expect(html).toContain('This cover letter is out of date.')
  expect(html).toContain('CV')
  expect(html).toContain('Cover letter')
  expect(html).toContain('disabled=""')
})

test('never renders a mismatched canonical letter as current content', () => {
  const foreign = { ...canonical, jobId: uid('9'), paragraphs: ['Foreign job content must not appear.'] }
  const html = renderReview({ canonical: foreign })
  expect(html).not.toContain('Foreign job content must not appear.')
  expect(html).toContain('current document does not match')
})

test('serializes edit sessions and advances identity epochs across A-B-A visits', () => {
  const paragraph = { kind: 'paragraph' as const, paragraphId: 'p1' }
  const recipient = { kind: 'recipient' as const }
  expect(canBeginRecipientEdit(paragraph)).toBe(false)
  expect(canBeginParagraphEdit(recipient)).toBe(false)
  expect(canBeginRecipientEdit(null)).toBe(true)
  expect(canBeginParagraphEdit(null)).toBe(true)
  const visitA = { identity: 'A', epoch: 0 }
  const visitB = advanceReviewVisit(visitA, 'B')
  const visitAAgain = advanceReviewVisit(visitB, 'A')
  expect(visitAAgain.epoch).toBe(2)
  expect(advanceReviewVisit(visitAAgain, 'A')).toEqual(visitAAgain)
})

test('places the sticky action bar before the paper in review markup', () => {
  const html = renderReview()
  expect(html.indexOf('cover-letter-action-bar')).toBeLessThan(html.indexOf('cover-letter-paper'))
})

test('uses paper palette colors with WCAG AA contrast for paper text and focus', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/renderer/cover-letter-review.css'), 'utf8')
  const match = (name: string) => {
    const found = css.match(new RegExp(`--paper-${name}:\\s*(#[0-9a-fA-F]{6})`))
    expect(found, `paper ${name} token`).toBeTruthy()
    return found![1]
  }
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  const contrast = (a: string, b: string) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (high + 0.05) / (low + 0.05)
  }
  const paperInk = match('ink')
  const paperAccent = match('accent')
  const paperSelected = match('selected')
  expect(contrast(paperInk, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  expect(contrast(match('muted'), '#ffffff')).toBeGreaterThanOrEqual(4.5)
  expect(contrast(paperAccent, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  expect(contrast(paperInk, paperSelected)).toBeGreaterThanOrEqual(4.5)
  expect(contrast(paperAccent, paperSelected)).toBeGreaterThanOrEqual(4.5)
})

test('shows action status and does not imply approval from a source acknowledgment', () => {
  const html = renderReview({ letter: { ...revision, acknowledgments: { [revision.paragraphs[0].id]: 'd'.repeat(64) } }, checkStatus: 'error', fitStatus: 'error', message: 'The page-fit check could not finish.', readiness: { canApprove: false, reason: 'Resolve the current checks.' } })
  expect(html).toContain('Check for issues')
  expect(html).toContain('Check one-page fit')
  expect(html).toContain('Approve cover letter')
  expect(html).toContain('The page-fit check could not finish.')
  expect(html).toContain('Approval is a separate decision')
  expect(html).not.toContain('approved="true"')
})
