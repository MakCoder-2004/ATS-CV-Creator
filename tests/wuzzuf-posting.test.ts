import { describe, expect, it } from 'vitest'
import { parseNamedPostingUrl } from '../src/shared/named-posting-schema'
import { fetchNamedPostingApi } from '../src/main/named-posting-api'

const url = 'https://wuzzuf.net/jobs/p/Abcdefgh1234'
const standardDescription = '<p>Build and maintain reliable distributed software systems. Work closely with product and engineering partners to deliver tested features, improve observability, and document operational decisions. Requirements include strong programming fundamentals and clear communication.</p>'
const page = (patch: { canonical?: string; title?: string; visibleTitle?: string; employer?: string; visibleEmployer?: string; description?: string; renderDescription?: boolean; extra?: string } = {}) => {
  const description = patch.description ?? standardDescription
  return `<html><head><link rel="canonical" href="${patch.canonical ?? url}"><script type="application/ld+json">${JSON.stringify({ '@context':'https://schema.org', '@type':'JobPosting', title:patch.title ?? 'Senior Engineer', hiringOrganization:{ '@type':'Organization', name:patch.employer ?? 'Example Systems' }, description })}</script></head><body><h1>${patch.visibleTitle ?? patch.title ?? 'Senior Engineer'}</h1><div class="company-name">${patch.visibleEmployer ?? patch.employer ?? 'Example Systems'}</div>${patch.renderDescription === false ? '' : `<div class="job-description">${description}</div>`}${patch.extra ?? ''}</body></html>`
}
const run = (body: string, overrides: Record<string, unknown> = {}) => fetchNamedPostingApi({ source:'wuzzuf', board:'wuzzuf', postingId:'Abcdefgh1234', submittedUrl:url, canonicalUrl:url }, {
  eligibility:{ personalLocalOptIn:true, source:'wuzzuf', scope:'personal-local', optedInAt:'2026-01-01T00:00:00.000Z' },
  now:()=>Date.parse('2026-01-02T00:00:00.000Z'),
  lookup:async()=>[{address:'8.8.8.8',family:4}],
  request:async()=>({status:200,headers:{'content-type':'text/html; charset=utf-8','content-encoding':'identity'},body:Buffer.from(body)}),
  ...overrides
} as any)

describe('Wuzzuf guarded exact posting adapter', () => {
  it('accepts only an exact one-posting Wuzzuf HTTPS page URL', () => {
    expect(parseNamedPostingUrl(url)).toMatchObject({ source:'wuzzuf', board:'wuzzuf', postingId:'Abcdefgh1234', canonicalUrl:url })
    for (const bad of ['http://wuzzuf.net/jobs/p/Abcdefgh1234','https://evil.example/jobs/p/Abcdefgh1234','https://wuzzuf.net/jobs/search?q=x','https://wuzzuf.net/jobs/p/Abcdefgh1234?x=y','https://wuzzuf.net/jobs/p/short']) expect(()=>parseNamedPostingUrl(bad)).toThrow()
  })
  it('pins DNS to a public address and returns the full corroborated source as a volatile candidate', async () => {
    const result = await run(page())
    expect(result.attempt.status).toBe('retrieved')
    expect(result.candidate).toMatchObject({ title:'Senior Engineer', employer:'Example Systems', completeness:'full', retrievalMethod:'wuzzuf-public-jobposting-v1', retrievalUrl:url })
    expect(result.candidate?.text.length).toBeGreaterThan(80)
  })
  it('fails closed on missing or multiple canonical identities, roles, and title/employer disagreements', async () => {
    expect((await run(page({canonical:'https://wuzzuf.net/jobs/p/OtherPosting123'}))).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
    expect((await run(page({extra:'<link rel="canonical" href="https://wuzzuf.net/jobs/p/OtherPosting123">'}))).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
    expect((await run(page({extra:`<script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',title:'Another role',hiringOrganization:{name:'Other employer'},description:standardDescription})}</script>`}))).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
    expect((await run(page({visibleTitle:'Different visible role'}))).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
    expect((await run(page({visibleEmployer:'Different employer'}))).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
  })
  it('sends only minimal headers and applies cancellation and response-byte limits', async () => {
    let observed: Readonly<Record<string,string>> | undefined
    const sent = await run(page(), { request:async (_url:URL, _address:unknown, _signal:AbortSignal, headers:Readonly<Record<string,string>>) => { observed = headers; return {status:200,headers:{'content-type':'text/html','content-encoding':'identity'},body:Buffer.from(page())} } })
    expect(sent.attempt.status).toBe('retrieved')
    expect(Object.keys(observed ?? {}).map(key=>key.toLowerCase()).sort()).toEqual(['accept','accept-encoding','user-agent'])
    expect((await run(page(), {request:async()=>({status:200,headers:{'content-type':'text/html'},body:Buffer.alloc(2*1024*1024+1)})})).attempt).toMatchObject({status:'failed',reason:'incomplete'})
    const controller = new AbortController(); controller.abort()
    const lookup = async () => [{address:'8.8.8.8',family:4}]
    const cancelled = await run(page(), {signal:controller.signal,lookup,request:async()=>{throw new Error('request must not run')} })
    expect(cancelled.attempt).toMatchObject({status:'failed',reason:'cancelled'})
  })
  it('rejects hidden, ancestor-hidden, and contradictory visible identity evidence', async () => {
    const clean = page()
    expect((await run(clean.replace('<h1>Senior Engineer</h1>', '<h1 hidden>Senior Engineer</h1>'))).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
    expect((await run(clean.replace('<h1>Senior Engineer</h1>', '<section aria-hidden="true"><h1>Senior Engineer</h1></section>'))).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
    expect((await run(clean.replace('<h1>Senior Engineer</h1>', '<h1 style="display:none">Senior Engineer</h1>'))).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
    expect((await run(clean.replace('<h1>Senior Engineer</h1>', '<h1 inert>Senior Engineer</h1>'))).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
    expect((await run(clean.replace('<h1>Senior Engineer</h1>', '<h1 class="sr-only">Senior Engineer</h1>'))).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
    expect((await run(clean.replace('<div class="company-name">Example Systems</div>', '<div class="company-name" style="visibility:hidden">Example Systems</div>'))).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
    expect((await run(clean.replace('<div class="company-name">Example Systems</div>', '<div class="company-name d-none">Example Systems</div>'))).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
    expect((await run(clean.replace('<div class="company-name">Example Systems</div>', '<div hidden><div class="company-name">Example Systems</div></div>'))).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
    expect((await run(page({renderDescription:false,extra:`<div aria-hidden="true">${standardDescription}</div>`}))).attempt).toMatchObject({status:'failed',reason:'incomplete'})
    expect((await run(page({extra:'<h1>Another role</h1>'}))).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
  })
  it('rejects unsafe DNS targets, redirects, login pages, and incomplete posting text', async () => {
    expect((await run(page(), {lookup:async()=>[{address:'127.0.0.1',family:4}]})).attempt).toMatchObject({status:'failed',reason:'unsafe-address'})
    expect((await run(page(), {request:async()=>({status:302,headers:{location:'https://evil.example'},body:Buffer.alloc(0)})})).attempt).toMatchObject({status:'failed',reason:'unsafe-redirect'})
    expect((await run('<html><body>Sign in</body></html>')).attempt.status).toBe('failed')
    expect((await run(page({description:'Short teaser'}))).attempt).toMatchObject({status:'failed',reason:'incomplete'})
    expect((await run(page({description:`<p>${'Complete-looking posting text. '.repeat(10)}<script>hidden instructions</script></p>`}))).attempt.status).toBe('failed')
    expect((await run(page({description:'<p>Some essential-looking source text that is not visibly in the document and therefore cannot be confirmed on the page.</p>',renderDescription:false}))).attempt).toMatchObject({status:'failed',reason:'incomplete'})
  })
})
