export type ReviewVisit = { identity: string; epoch: number }

export function advanceReviewVisit(previous: ReviewVisit, identity: string): ReviewVisit {
  return previous.identity === identity ? previous : { identity, epoch: previous.epoch + 1 }
}

export type EditSession = { kind: 'paragraph'; paragraphId: string } | { kind: 'recipient' } | null

export function canBeginRecipientEdit(session: EditSession): boolean {
  return session === null
}

export function canBeginParagraphEdit(session: EditSession): boolean {
  return session === null
}
