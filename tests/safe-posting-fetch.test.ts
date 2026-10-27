import { describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:net'
import { request as httpsRequest } from 'node:https'
import { fetchLeverPosting, isPublicAddress, pinnedAddressLookup, validateLeverPostingUrl } from '../src/main/safe-posting-fetch'

const url = 'https://api.lever.co/v0/postings/acme/role-123'
const lookup = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }])

describe('paused Lever posting fetch', () => {
  it('validates only named hosted detail URLs without fetching', () => {
    expect(validateLeverPostingUrl(url)).toBe(true)
    for (const value of ['http://jobs.lever.co/acme/role', 'https://evil.test/acme/role', 'https://jobs.lever.co/acme', 'https://user@jobs.lever.co/acme/role', 'https://jobs.lever.co/acme/role?token=x']) expect(validateLeverPostingUrl(value)).toBe(false)
  })
  it('connects through a pinned address when HTTPS requests all DNS addresses', async () => {
    let connections = 0
    const server = createServer(socket => { connections++; socket.destroy() })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const listener = server.address()
      if (!listener || typeof listener === 'string') throw new Error('Test socket has no TCP port.')
      const error = await new Promise<Error>((resolve, reject) => {
        const request = httpsRequest(`https://api.lever.co:${listener.port}/test`, { agent: false, lookup: pinnedAddressLookup({ address: '127.0.0.1', family: 4 }) }, response => { response.destroy(); reject(new Error('Unexpected HTTPS response from the raw test socket.')) })
        request.setTimeout(3_000, () => request.destroy(new Error('Local transport test timed out.')))
        request.once('error', resolve)
        request.end()
      })
      expect(error.message).not.toMatch(/invalid IP address/i)
      expect(connections).toBe(1)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })
  it('refuses generic and former hosted Lever routes before DNS lookup or request dispatch', async () => {
    const dns = vi.fn(lookup), request = vi.fn()
    for (const input of [url, 'https://jobs.lever.co/acme/role-123']) await expect(fetchLeverPosting(input, { lookup: dns, request })).rejects.toThrow(/Lever.*paused/i)
    expect(dns).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })
  it('rejects special-use address ranges', () => {
    for (const ip of ['10.0.0.1', '169.254.1.1', '192.168.1.1', '100.64.0.1', '192.0.2.1', '192.88.99.4', '198.51.100.2', '203.0.113.1', '240.0.0.1']) expect(isPublicAddress(ip, 4)).toBe(false)
    for (const ip of ['::1', 'fc00::1', 'fe80::1', '2001:db8::1', '2001:1::1', '2001:20::1', '::ffff:127.0.0.1', '::ffff:192.168.1.1']) expect(isPublicAddress(ip, 6), ip).toBe(false)
    expect(isPublicAddress('8.8.8.8', 4)).toBe(true)
    expect(isPublicAddress('2606:4700:4700::1111', 6)).toBe(true)
  })
})
