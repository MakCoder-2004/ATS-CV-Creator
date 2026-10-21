import { describe, expect, it } from 'vitest'
import { bindProfileAiResult, minimizeProfileText, PROFILE_AI_RESIDUAL_NOTICE } from '../src/shared/profile-ai-structuring'
import { profilePdfProposalSchema } from '../src/shared/profile-pdf-import'

const proposal = profilePdfProposalSchema.parse({
  skills: [], experience: [], projects: [], entries: [], unmapped: [],
  sources: [{ proposalRef: 'skill:0', proposalId: 'd2af9bab-779b-4c6a-90e2-14a6f122c9c1', page: 1, passage: 'Skills: TypeScript', field: 'skills.TypeScript' }],
  proposalIds: { 'skill:0': 'd2af9bab-779b-4c6a-90e2-14a6f122c9c1' }
})

describe('profile AI outgoing projection', () => {
  it('redacts recognizable email and phone locally and discloses residual sensitivity', () => {
    const minimized = minimizeProfileText('Contact ada@example.test or +1 (555) 123-4567 about confidential work')
    expect(minimized.text).toBe('Contact [EMAIL_1] or [PHONE_2] about confidential work')
    expect(minimized.replacements).toEqual([{ token: '[EMAIL_1]', value: 'ada@example.test' }, { token: '[PHONE_2]', value: '+1 (555) 123-4567' }])
    expect(PROFILE_AI_RESIDUAL_NOTICE).toMatch(/does not make this anonymous/i)
  })

  it('retains application-issued identity and rejects citations not in the local CV preview', () => {
    const response = { skills: [], experience: [], projects: [], entries: [], unmapped: [], citations: [{ proposalRef: 'skill:0', page: 1, passage: 'Skills: TypeScript', field: 'skills.TypeScript' }] }
    const result = bindProfileAiResult(proposal, response as never)
    expect(result.proposalIds).toEqual(proposal.proposalIds)
    expect(result.sources).toEqual(proposal.sources)
    expect(() => bindProfileAiResult(proposal, { ...response, citations: [{ ...response.citations[0], passage: 'invented' }] } as never)).toThrow(/outside this CV review/)
  })
})
