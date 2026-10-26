import { describe, expect, it, vi } from 'vitest'
import { createNamedPostingPreviewSession } from '../../src/main/named-posting-preview-session'

describe('volatile named posting preview', () => {
  it('requires opt-in and leaves Lever paused without provider access', async () => {
    const request = vi.fn()
    const session = createNamedPostingPreviewSession({ lookup: async () => { throw new Error('must not resolve DNS') }, request: request as never })
    await expect(session.start('https://boards.greenhouse.io/acme/jobs/123', false)).rejects.toThrow(/personal-local/)
    const lever = await session.start('https://jobs.lever.co/acme/123', true)
    expect(lever.reason).toMatch(/paused/i)
    expect(request).not.toHaveBeenCalled()
  })
  it('keeps a successful exact Greenhouse response temporary and discards it on cancel', async () => {
    const session = createNamedPostingPreviewSession({
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      request: async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ id: 123, title: 'Synthetic engineer', company_name: 'Example Co', content: `<p>${'Build reliable systems and document decisions. '.repeat(5)}</p>` })) })
    })
    const started = await session.start('https://boards.greenhouse.io/acme/jobs/123', true)
    const preview = session.read(started.token)
    expect(preview.status).toBe('ready')
    expect(preview.status).toBe('ready')
    if (preview.status !== 'ready') throw new Error('Expected successful synthetic preview.')
    expect(preview.candidate?.title).toBe('Synthetic engineer')
    expect(preview.candidate?.employer).toBe('Example Co')
    expect(preview.candidate?.text).toContain('Build reliable systems')
    expect(session.cancel(started.token)).toEqual({ ok: true })
    expect(session.read(started.token).status).toBe('expired')
  })
})
