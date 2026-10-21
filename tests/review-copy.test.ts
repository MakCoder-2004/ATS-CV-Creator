import { expect, test } from 'vitest'
import { describeSource, readableText } from '../src/renderer/review-copy'

test('review descriptions turn serialized career facts into human-readable source names', () => {
  const source = describeSource({ text: '{"kind":"employment","title":"Engineer 19","organization":"Systems 19","description":"Built reliable services."}' })
  expect(source).toEqual({ heading: 'Engineer 19 · Systems 19', detail: 'Built reliable services.' })
  expect(JSON.stringify(source)).not.toContain('"kind"')
  expect(describeSource({ title: 'Platform Engineer', organization: 'Example Co', description: 'Maintained tools.' })).toEqual({ heading: 'Platform Engineer · Example Co', detail: 'Maintained tools.' })
})

test('review copy never prints opaque JSON or malformed serialized data', () => {
  expect(readableText('{"description":"Supported Unicode."}')).toBe('Supported Unicode.')
  expect(readableText('{"internal":"not for review"}')).toBe('')
  expect(readableText('{"kind":')).toBe('')
  expect(readableText('Clear ordinary wording.')).toBe('Clear ordinary wording.')
  expect(describeSource({ text: '{"internal":"not for review"}' })).toEqual({ heading: 'Saved career fact', detail: '' })
})
