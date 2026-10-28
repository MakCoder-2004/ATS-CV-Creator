export type ApplicationDocument = 'cv' | 'cover-letter'

export type ApplicationDocumentSelectorProps = {
  selected: ApplicationDocument
  cvStatus: string
  coverLetterStatus: string
  onSelect: (document: ApplicationDocument) => void
}

export function ApplicationDocumentSelector({ selected, cvStatus, coverLetterStatus, onSelect }: ApplicationDocumentSelectorProps) {
  return <div className="cover-letter-document-selector" aria-label="Application document">
    <div role="group" aria-label="Select a document">
      <button type="button" aria-pressed={selected === 'cv'} onClick={() => onSelect('cv')}>CV</button>
      <button type="button" aria-pressed={selected === 'cover-letter'} onClick={() => onSelect('cover-letter')}>Cover letter</button>
    </div>
    <p>CV status: <strong>{cvStatus}</strong></p>
    <p>Cover letter status: <strong>{coverLetterStatus}</strong></p>
  </div>
}
