import { describe, expect, it, vi } from 'vitest'
import { createNamedPostingPreviewSession } from '../../src/main/named-posting-preview-session'
import { decideJobSourcePolicy } from '../../src/shared/job-source-policy'
import { fetchDirectJobResearch } from '../../src/main/job-research-fetch'
import { fetchLeverPosting } from '../../src/main/safe-posting-fetch'

const url = 'https://boards.greenhouse.io/acme/jobs/123'
const response = () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ id: 123, title: 'Synthetic engineer', company_name: 'Example Co', content: `<p>${'Build reliable systems and document decisions. '.repeat(5)}</p>`, updated_at: '2026-10-25T12:00:00Z' })) })
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

 describe('volatile named posting preview', () => {
  it('requires opt-in and pauses Lever before DNS/provider access', async () => {
    const lookup = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]), request = vi.fn()
    const session = createNamedPostingPreviewSession({ lookup, request: request as never })
    expect(() => session.start(url, false)).toThrow(/personal-local/)
    expect(() => session.start('https://jobs.lever.co/acme/123', true)).toThrow(/Lever/i)
    expect(lookup).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled()
  })
  it('returns loading before lookup completes; cancel aborts and late response cannot restore data', async () => {
    const pending = deferred<Array<{ address: string; family: number }>>()
    const lookup = vi.fn(() => pending.promise), request = vi.fn()
    const session = createNamedPostingPreviewSession({ lookup, request: request as never })
    const { token } = session.start(url, true)
    expect(session.read(token).status).toBe('loading')
    session.cancel(token)
    expect(session.read(token).status).toBe('expired')
    pending.resolve([{ address: '8.8.8.8', family: 4 }])
    await Promise.resolve(); await Promise.resolve()
    expect(session.read(token).status).toBe('expired'); expect(request).not.toHaveBeenCalled()
  })
  it('returns schema-validated detached candidate and expires temporary state', async () => {
    let now = Date.now()
    const session = createNamedPostingPreviewSession({ lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => response() }, () => now)
    const { token } = session.start(url, true)
    for (let i = 0; i < 30 && session.read(token).status === 'loading'; i++) await new Promise(resolve => setTimeout(resolve, 20))
    const first = session.read(token)
    expect(first.status).toBe('ready')
    if (first.status !== 'ready') throw new Error('Expected synthetic ready state')
    expect(first.candidate.title).toBe('Synthetic engineer')
    expect(first.candidate.sourceUpdatedAt).toBe('2026-10-25T12:00:00.000Z')
    first.candidate.title = 'renderer mutation'
    const second = session.read(token)
    expect(second.status === 'ready' && second.candidate.title).toBe('Synthetic engineer')
    now += 10 * 60_000
    expect(session.read(token).status).toBe('expired')
    session.close()
  })
  it('close aborts and prevents new starts; generic Greenhouse paths are gated before network', async () => {
    const pending = deferred<{ status: number; headers: { 'content-type': string }; body: Buffer }>()
    let requestSignal: AbortSignal | undefined
    const lookup = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }])
    const session = createNamedPostingPreviewSession({ lookup, request: async (_url, _address, signal) => { requestSignal = signal; return pending.promise } })
    const started = session.start(url, true)
    for (let i = 0; i < 20 && !requestSignal; i++) await new Promise(resolve => setTimeout(resolve, 10))
    session.close()
    expect(requestSignal?.aborted).toBe(true)
    expect(session.read(started.token).status).toBe('expired')
    expect(() => session.start(url, true)).toThrow(/closed/)
    expect(decideJobSourcePolicy(url).status).toBe('paused')
    lookup.mockClear()
    await expect(fetchDirectJobResearch(url, { lookup })).rejects.toThrow(/Greenhouse/i)
    expect(lookup).not.toHaveBeenCalled()
  })
  it('pauses both EU Lever hosts before DNS or requests and rejects EU named URLs', async () => {
    const lookup = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]), request = vi.fn()
    for (const input of ['https://jobs.eu.lever.co/acme/123', 'https://api.eu.lever.co/v0/postings/acme/123']) {
      expect(decideJobSourcePolicy(input)).toMatchObject({ status: 'paused', source: 'lever' })
      await expect(fetchDirectJobResearch(input, { lookup })).rejects.toThrow(/Lever/i)
      await expect(fetchLeverPosting(input, { lookup, request: request as never })).rejects.toThrow(/Lever/i)
    }
    expect(() => createNamedPostingPreviewSession().start('https://jobs.eu.lever.co/acme/123', true)).toThrow(/Greenhouse/)
    expect(lookup).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled()
  })
  it('requires explicit source review and rejects a reviewed token after expiry before persistence', async () => {
    let now = Date.now()
    const session = createNamedPostingPreviewSession({ lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => response() }, () => now)
    const { token } = session.start(url, true)
    for (let i = 0; i < 30 && session.read(token).status === 'loading'; i++) await new Promise(resolve => setTimeout(resolve, 20))
    expect(() => session.review(token, false, true)).toThrow(/exact role/i)
    const reviewed = session.review(token, true, true)
    const persist = vi.fn(async () => ({ ok: true }))
    now += 10 * 60_000
    await expect(session.save(token, reviewed.reviewToken, { title: 'Engineer', company: 'Example Co', description: 'Synthetic text' }, persist, result => result.ok)).rejects.toThrow(/expired/i)
    expect(persist).not.toHaveBeenCalled()
    session.close()
  })
  it('rejects a provider result with the wrong posting ID without exposing a candidate', async () => {
    const body = Buffer.from(JSON.stringify({ ...JSON.parse(response().body.toString()), id: 456 }))
    const session = createNamedPostingPreviewSession({ lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => ({ ...response(), body }) })
    const { token } = session.start(url, true)
    for (let i = 0; i < 30 && session.read(token).status === 'loading'; i++) await new Promise(resolve => setTimeout(resolve, 20))
    expect(session.read(token).status).toBe('failed')
    session.cancel(token)
  })
})
