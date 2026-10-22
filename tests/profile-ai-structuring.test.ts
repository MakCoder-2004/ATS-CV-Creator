import { describe, expect, it } from 'vitest'
import { minimizeProfileText, PROFILE_AI_RESIDUAL_NOTICE, validateProfileAiDraft } from '../src/shared/profile-ai-structuring'
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

  it('rejects a factual passage attributed to a different source role', () => {
    const source = profilePdfProposalSchema.parse({
      skills: [], experience: [
        { kind: 'employment', organization: 'Alpha', title: 'Engineer', description: 'Experience: Alpha | Engineer', factualItems: [{ text: 'Built Alpha service', proposalRef: 'role-a:fact:0' }], proposalRef: 'role-a' },
        { kind: 'employment', organization: 'Beta', title: 'Engineer', description: 'Experience: Beta | Engineer', factualItems: [{ text: 'Built Beta service', proposalRef: 'role-b:fact:0' }], proposalRef: 'role-b' }
      ], projects: [], entries: [], unmapped: [],
      sources: [
        { proposalRef: 'role-a', proposalId: 'd2af9bab-779b-4c6a-90e2-14a6f122c9c1', page: 1, passage: 'Experience: Alpha | Engineer', field: 'experience.role' },
        { proposalRef: 'role-a:fact:0', proposalId: 'c8a20c01-6f36-4ea8-912e-f07b22c54c03', page: 1, passage: 'FACT: Built Alpha service', field: 'experience.factualItem' },
        { proposalRef: 'role-b', proposalId: '1b2aa172-24b9-43cf-8466-9344c2854e2c', page: 1, passage: 'Experience: Beta | Engineer', field: 'experience.role' },
        { proposalRef: 'role-b:fact:0', proposalId: 'c806aab1-eaf6-453e-a8f6-dd8770b01fe0', page: 1, passage: 'FACT: Built Beta service', field: 'experience.factualItem' }
      ],
      proposalIds: { 'role-a': 'd2af9bab-779b-4c6a-90e2-14a6f122c9c1', 'role-a:fact:0': 'c8a20c01-6f36-4ea8-912e-f07b22c54c03', 'role-b': '1b2aa172-24b9-43cf-8466-9344c2854e2c', 'role-b:fact:0': 'c806aab1-eaf6-453e-a8f6-dd8770b01fe0' }
    })
    const wrongParent = { contact: undefined, skills: [], experience: [{ kind: 'employment', organization: 'Alpha', title: 'Engineer', description: 'Experience: Alpha | Engineer', factualItems: [{ text: 'Built Beta service', proposalRef: 'ai-fact' }], proposalRef: 'ai-role' }], projects: [], entries: [], unmapped: [], sources: [{ proposalRef: 'ai-role', page: 1, passage: 'Experience: Alpha | Engineer', field: 'experience.role' }, { proposalRef: 'ai-fact', page: 1, passage: 'FACT: Built Beta service', field: 'experience.factualItem' }] }
    expect(() => validateProfileAiDraft(source, wrongParent as never, () => '6cfd85b9-3946-452e-a227-787adf9007a6')).toThrow(/different role/)
  })

  it('keeps application-issued identity and rejects model sources outside the local CV preview', () => {
    const draft = { contact: undefined, skills: [{ name: 'TypeScript', category: 'Technical', proposalRef: 'skill:0' }], experience: [], projects: [], entries: [], unmapped: [], sources: [{ proposalRef: 'skill:0', page: 1, passage: 'Skills: TypeScript', field: 'skills.TypeScript' }] }
    const result = validateProfileAiDraft(proposal, draft as never, () => '6cfd85b9-3946-452e-a227-787adf9007a6')
    expect(result.proposalIds).toEqual(proposal.proposalIds)
    expect(result.sources[0].proposalId).toBe(proposal.proposalIds['skill:0'])
    expect(() => validateProfileAiDraft(proposal, { ...draft, sources: [{ ...draft.sources[0], passage: 'invented' }] } as never, () => '6cfd85b9-3946-452e-a227-787adf9007a6')).toThrow(/outside this CV review/)
  })
})
