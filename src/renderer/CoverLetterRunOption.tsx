export type CoverLetterRunOptionProps = {
  checked: boolean
  disabled: boolean
  authorizedPurpose?: 'cv' | 'cv+cover-letter' | null
  onChange: (included: boolean) => void
}

export function CoverLetterRunOption({ checked, disabled, authorizedPurpose, onChange }: CoverLetterRunOptionProps) {
  return <div className="cover-letter-purpose-control">
    {authorizedPurpose && <p className="cover-letter-purpose-banner" role="status">Authorized purpose: {authorizedPurpose === 'cv+cover-letter' ? 'CV and cover letter' : 'CV only'}. Changing this choice requires a refreshed preview and fresh authorization.</p>}
    <fieldset className="cover-letter-run-option">
    <legend>Optional document</legend>
    <label>
      <input type="checkbox" checked={authorizedPurpose ? authorizedPurpose === 'cv+cover-letter' : checked} disabled={disabled || Boolean(authorizedPurpose)} onChange={event => onChange(event.currentTarget.checked)} />
      <span><strong>Include a cover letter</strong><span className="cover-letter-run-help">Including a letter adds one model request for this posting. The entered recipient name stays on this device and is not sent to Pi.</span></span>
    </label>
    </fieldset>
  </div>
}
