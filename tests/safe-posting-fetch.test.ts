import { describe, expect, it, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import { fetchLeverPosting, isPublicAddress, validateLeverPostingUrl } from '../src/main/safe-posting-fetch'

const url = 'https://api.lever.co/v0/postings/acme/role-123'
const headers = { 'content-type': 'application/json' }
const response = (body: unknown, status = 200) => ({ status, headers, body: Buffer.from(JSON.stringify({ id: 'role-123', ...body as object })) })
const lookup = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }])

describe('bounded Lever posting fetch', () => {
  it('validates only named hosted detail URLs without fetching', () => {
    expect(validateLeverPostingUrl(url)).toBe(true)
    for (const value of ['http://jobs.lever.co/acme/role', 'https://evil.test/acme/role', 'https://jobs.lever.co/acme', 'https://user@jobs.lever.co/acme/role', 'https://jobs.lever.co/acme/role?token=x']) expect(validateLeverPostingUrl(value)).toBe(false)
  })
  it('resolves one named detail, preserves complete plain text, and reports missing company', async () => {
    const request = vi.fn(async () => response({ text: 'Engineer', descriptionPlain: 'Build systems\nOwn reliability', hostedUrl: 'https://evil.test/' }))
    const preview = await fetchLeverPosting(url, { lookup, request })
    expect(request).toHaveBeenCalledTimes(1)
    expect(preview).toMatchObject({ title: 'Engineer', company: null, description: 'Build systems\nOwn reliability', submittedUrl: url })
    expect(preview.notices).toContainEqual(expect.stringContaining('Employer name'))
    expect(preview.finalUrl).toBe('https://api.lever.co/v0/postings/acme/role-123')
  })
  it('rejects private DNS answers before requesting and never follows external redirects', async () => {
    const request = vi.fn()
    await expect(fetchLeverPosting(url, { lookup: async () => [{ address: '127.0.0.1', family: 4 }], request })).rejects.toThrow('non-public')
    expect(request).not.toHaveBeenCalled()
    await expect(fetchLeverPosting(url, { lookup, request: async () => ({ status: 302, headers: {}, body: Buffer.alloc(0), location: 'https://evil.test/path' }) })).rejects.toThrow('outside the approved')
  })
  it('single-request release validation never retries or follows redirects', async () => {
    const retryResponse = vi.fn(async () => ({ status: 503, headers: {}, body: Buffer.alloc(0) }))
    await expect(fetchLeverPosting(url, { lookup, request: retryResponse, singleRequest: true })).rejects.toThrow(/HTTP 503/)
    expect(retryResponse).toHaveBeenCalledTimes(1)
    const redirectResponse = vi.fn(async () => ({ status: 302, headers: {}, body: Buffer.alloc(0), location: 'https://api.lever.co/v0/postings/acme/role-123' }))
    await expect(fetchLeverPosting(url, { lookup, request: redirectResponse, singleRequest: true })).rejects.toThrow(/single-request/i)
    expect(redirectResponse).toHaveBeenCalledTimes(1)
    const socketFailure = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
    const failedRequest = vi.fn(async () => { throw socketFailure })
    const started = vi.fn(), completed = vi.fn()
    await expect(fetchLeverPosting(url, { lookup, request: failedRequest, singleRequest: true, onRequestStarted: started, onRequestCompleted: completed })).rejects.toThrow(/connection failed or timed out/)
    expect(failedRequest).toHaveBeenCalledTimes(1)
    expect(started).toHaveBeenCalledTimes(1)
    expect(completed).not.toHaveBeenCalled()
  }, 10_000)
  it('rejects adversarially deep HTML safely instead of recursing through the tree', async () => {
    const html = `${'<div>'.repeat(300)}<h1>Deep role</h1>${'</div>'.repeat(300)}`
    await expect(fetchLeverPosting('https://jobs.lever.co/acme/deep', { lookup, request: async () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(html) }) })).rejects.toThrow(/nested too deeply/)
  })
  it('terminates expensive HTML parsing at the two-second worker budget', async () => {
    const repeated = '<table><tr><td>x</table>'.repeat(300_000)
    const html = `<main><h1>Engineer</h1><p class="company">Example</p><article class="posting">${repeated}</article></main>`
    const body = gzipSync(Buffer.from(html))
    expect(body.byteLength).toBeLessThan(2 * 1024 * 1024)
    await expect(fetchLeverPosting('https://jobs.lever.co/acme/timeout', { lookup, request: async () => ({ status: 200, headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' }, body }) })).rejects.toThrow(/2-second budget/)
  }, 10_000)
  it('rejects special-use address ranges', () => {
    for (const ip of ['10.0.0.1', '169.254.1.1', '192.168.1.1', '100.64.0.1', '192.0.2.1', '192.88.99.4', '198.51.100.2', '203.0.113.1', '240.0.0.1']) expect(isPublicAddress(ip, 4)).toBe(false)
    for (const ip of ['::1', 'fc00::1', 'fe80::1', '2001:db8::1', '2001:1::1', '2001:20::1', '::ffff:127.0.0.1', '::ffff:192.168.1.1']) expect(isPublicAddress(ip, 6), ip).toBe(false)
    expect(isPublicAddress('8.8.8.8', 4)).toBe(true)
    expect(isPublicAddress('2606:4700:4700::1111', 6)).toBe(true)
  })
})
