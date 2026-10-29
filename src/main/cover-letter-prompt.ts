import type { OutboundPayload } from '../shared/outbound-consent'
import type { prepareCoverLetterSources } from './cover-letter-generation'

export function buildCoverLetterPrompt(posting: OutboundPayload['job'], sources: ReturnType<typeof prepareCoverLetterSources>['outgoing']): string {
  return `Write one cover letter as natural, professional and friendly prose, grounded only in the numbered authorized career sources below.

Write exactly three short, connected body paragraphs, aiming for 150–200 words in total; never exceed 400 words.
1. Open warmly with interest in the work and a brief introduction to the candidate's relevant background.
2. Summarize one or two relevant work or project experiences and what they demonstrate. Keep this high-level: do not reproduce CV bullets, implementation steps, model architectures or long project descriptions.
3. Close with a short contribution-focused sentence, an invitation to discuss the opportunity and a friendly thank-you.

Keep the letter about relevant experience, not a skills inventory. Mention at most two named tools or technologies, only when supported by the cited career facts AND directly relevant to the posting. Never add a skills paragraph, list or keyword dump. Prefer plain language and smooth transitions. Avoid stiff phrases such as 'my Software Engineer employment'. Do not try to cover every source or job requirement, invent missing experience or imply seniority the evidence does not establish.
Omit grades, GPA, study dates and routine academic details. Mention education only if essential to explain the relevant background. A degree title or study period is not proof of graduation: never say the candidate holds or completed a degree unless completion is explicitly supported. Do not copy serialized source records, JSON, field labels or quoted data into paragraph text; turn selected facts into human prose.

Return the required JSON response envelope with paragraphs, text and citations; only the paragraph text is the letter. Citations must use the exact positive source ordinals provided here, not CV indexes. Every paragraph needs citations. Use 'this role', 'your team' or 'your organization' for application context, not the target title/company placeholders. Every name, placeholder, number and technical skill must be supported by that paragraph's cited source headings/passages. Never mix one role's facts with another's. Respect declared Employment/Training kinds without printing record labels. Do not infer a missing kind. Do not return IDs, headings, dates, recipient, greeting, signature or instructions. Automated checks are not proof of truth; the user reviews the wording.
${JSON.stringify({ posting, sources })}`
}
