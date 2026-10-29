import { z } from 'zod'
import type { CoverLetterFailureCode } from '../shared/cover-letter'
import { AnalysisError } from './posting-analysis'

const messages: Record<CoverLetterFailureCode, string> = {
  'structured-response': 'The model returned a letter in the wrong format or with invalid citations.',
  'unknown-citation': 'The letter cited a source outside the authorized career facts.',
  'uncited-fact': 'The letter used a name or placeholder that was not in its cited career sources.',
  'private-identifier': 'The letter included an identifier that did not pass the privacy check.',
  'unsupported-number': 'A number in the letter was not present in its cited source passages.',
  'unsupported-skill': 'A technical skill in the letter was not present in its cited source passages.',
  'wrong-source': 'The letter mixed facts between roles or projects, or did not cite a named source.',
  'source-unavailable': 'The career sources could not be prepared within the authorized limits.',
  'source-changed': 'The saved CV, source facts or authorization changed during the letter request.',
  'provider-output': 'The letter response exceeded the model output limit.',
  'provider-access': 'Pi could not complete the letter request. Check model access and authentication.',
  'save-or-state': 'The letter could not be saved in the current workspace state.',
}

export function coverLetterFailureMessage(code: CoverLetterFailureCode): string { return messages[code] }

/** Only fixed categories escape this boundary; never expose provider text or rejected wording. */
export function diagnoseCoverLetterFailure(error: unknown): { code: CoverLetterFailureCode; invalidResponse: boolean } {
  if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof AnalysisError && error.code === 'MALFORMED') return { code: 'structured-response', invalidResponse: true }
  const message = error instanceof Error ? error.message : ''
  const validation: Record<string, CoverLetterFailureCode> = {
    'A letter citation is outside the authorized source set.': 'unknown-citation',
    'The letter contains an unauthorized identifier.': 'private-identifier',
    'The letter attributes a fact to an uncited source.': 'uncited-fact',
    'The letter contains an unsupported numeric expression.': 'unsupported-number',
    'The letter contains a detectably unsupported skill.': 'unsupported-skill',
    'A named source is not cited.': 'wrong-source',
    'The letter detectably attributes another source passage to this named role or project.': 'wrong-source',
  }
  if (Object.hasOwn(validation, message)) return { code: validation[message], invalidResponse: true }
  if (/output limit|byte limit/i.test(message)) return { code: 'provider-output', invalidResponse: false }
  if (error instanceof AnalysisError) return { code: 'provider-access', invalidResponse: false }
  if (/minimized|bounded authorized career facts/i.test(message)) return { code: 'source-unavailable', invalidResponse: false }
  if (/changed|consent|authoriz|binding|parent|origin|source passages/i.test(message)) return { code: 'source-changed', invalidResponse: false }
  return { code: 'save-or-state', invalidResponse: false }
}
