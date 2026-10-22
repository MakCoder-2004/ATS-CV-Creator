import { describe, expect, it, vi } from 'vitest'
import { fetchLeverPosting, isPublicAddress, validateLeverPostingUrl } from '../src/main/safe-posting-fetch'

const url = 'https://jobs.lever.co/acme/role-123'
const headers = { 'content-type': 'application/json' }
const response = (body: unknown, status = 200) => ({ status, headers, body: Buffer.from(JSON.stringify(body)) })
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
    expect(preview).toMatchObject({ title: 'Engineer', company: null, description: 'Build systems\nOwn reliability', submittedUrl: url, notices: [expect.stringContaining('Employer name')] })
    expect(preview.finalUrl).toBe('https://api.lever.co/v0/postings/acme/role-123')
  })
  it('rejects private DNS answers before requesting and never follows external redirects', async () => {
    const request = vi.fn()
    await expect(fetchLeverPosting(url, { lookup: async () => [{ address: '127.0.0.1', family: 4 }], request })).rejects.toThrow('non-public')
    expect(request).not.toHaveBeenCalled()
    await expect(fetchLeverPosting(url, { lookup, request: async () => ({ status: 302, headers: {}, body: Buffer.alloc(0), location: 'https://evil.test/path' }) })).rejects.toThrow('outside the approved')
  })
  it('rejects special-use address ranges', () => {
    for (const ip of ['10.0.0.1', '169.254.1.1', '192.168.1.1', '100.64.0.1']) expect(isPublicAddress(ip, 4)).toBe(false)
    for (const ip of ['::1', 'fc00::1', 'fe80::1', '2001:db8::1', '::ffff:127.0.0.1']) expect(isPublicAddress(ip, 6)).toBe(false)
    expect(isPublicAddress('8.8.8.8', 4)).toBe(true)
    expect(isPublicAddress('2606:4700:4700::1111', 6)).toBe(true)
  })
})
