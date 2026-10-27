import { describe, expect, it } from 'vitest'
import { describeNamedPostingFailure, namedPostingAttemptSchema, parseNamedPostingUrl } from '../src/shared/named-posting-schema'
import { fetchNamedPostingApi } from '../src/main/named-posting-api'

const url = 'https://wuzzuf.net/jobs/p/Abcdefgh1234'
const standardDescription = '<p>Build and maintain reliable distributed software systems. Work closely with product and engineering partners to deliver tested features, improve observability, and document operational decisions. Requirements include strong programming fundamentals and clear communication.</p>'
const page = (patch: { canonical?: string|null; title?: string; visibleTitle?: string; employer?: string; visibleEmployer?: string; description?: string; renderDescription?: boolean; showTitle?: boolean; showEmployer?: boolean; showStructured?: boolean; extra?: string } = {}) => {
  const description = patch.description ?? standardDescription
  const canonical = patch.canonical === undefined ? `<link rel="canonical" href="${url}">` : patch.canonical ? `<link rel="canonical" href="${patch.canonical}">` : ''
  const structured = patch.showStructured === false ? '' : `<script type="application/ld+json">${JSON.stringify({ '@context':'https://schema.org', '@type':'JobPosting', title:patch.title ?? 'Senior Engineer', hiringOrganization:{ '@type':'Organization', name:patch.employer ?? 'Example Systems' }, description }).replace(/</g, '\\u003c')}</script>`
  return `<html><head>${canonical}${structured}</head><body>${patch.showTitle === false ? '' : `<h1>${patch.visibleTitle ?? patch.title ?? 'Senior Engineer'}</h1>`}${patch.showEmployer === false ? '' : `<div class="company-name">${patch.visibleEmployer ?? patch.employer ?? 'Example Systems'}</div>`}${patch.renderDescription === false ? '' : `<div class="job-description">${description}</div>`}${patch.extra ?? ''}</body></html>`
}
const run = (body: string, overrides: Record<string, unknown> = {}) => fetchNamedPostingApi({ source:'wuzzuf', board:'wuzzuf', postingId:'Abcdefgh1234', submittedUrl:url, canonicalUrl:url }, {
  eligibility:{ personalLocalOptIn:true, source:'wuzzuf', scope:'personal-local', optedInAt:'2026-01-01T00:00:00.000Z' },
  now:()=>Date.parse('2026-01-02T00:00:00.000Z'),
  lookup:async()=>[{address:'8.8.8.8',family:4}],
  request:async()=>({status:200,headers:{'content-type':'text/html; charset=utf-8','content-encoding':'identity'},body:Buffer.from(body)}),
  ...overrides
} as any)

const failedDiagnostic = async (html:string) => {
  const result = await run(html)
  expect(result.attempt.status).toBe('failed')
  if (result.attempt.status !== 'failed') throw new Error('Expected safe diagnostic failure')
  expect(result.candidate).toBeUndefined()
  return result.attempt.diagnostic
}

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
  it('returns separate bounded diagnostics for raw canonical identity failures', async () => {
    expect(await failedDiagnostic(page({canonical:null}))).toBe('canonical-missing')
    expect(await failedDiagnostic(page({canonical:'https://wuzzuf.net/jobs/p/OtherPosting123'}))).toBe('canonical-mismatch')
    expect(await failedDiagnostic(page({canonical:'https://example.test/role/123'}))).toBe('canonical-malformed')
    expect(await failedDiagnostic(page({extra:'<link rel="canonical" href="not a URL">'}))).toBe('canonical-multiple')
  })
  it('carries only the bounded diagnostic enum through the strict attempt contract and safe explanation map', async () => {
    const result = await run(page({extra:'<link rel="canonical" href="not a URL">'}))
    const attempt = namedPostingAttemptSchema.parse(result.attempt)
    expect(attempt).toMatchObject({status:'failed', reason:'ambiguous', diagnostic:'canonical-multiple'})
    if (attempt.status !== 'failed') throw new Error('Expected failed Wuzzuf attempt')
    expect(describeNamedPostingFailure(attempt)).toBe('The page declares multiple canonical links, so the exact posting identity is ambiguous.')
    const otherSource = { ...attempt, reference:{ source:'greenhouse', board:'acme', postingId:'123', submittedUrl:'https://boards.greenhouse.io/acme/jobs/123', canonicalUrl:'https://boards.greenhouse.io/acme/jobs/123' } }
    expect(namedPostingAttemptSchema.safeParse(otherSource).success).toBe(false)
  })
  it('diagnoses missing, malformed and multiple structured roles without including source text', async () => {
    expect(await failedDiagnostic(page({showStructured:false}))).toBe('structured-data-missing')
    expect(await failedDiagnostic(page({extra:'<script type="application/ld+json">{broken-json</script>'}))).toBe('structured-data-invalid')
    expect(await failedDiagnostic(page({extra:`<script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',title:'Another role',hiringOrganization:{name:'Other employer'},description:standardDescription})}</script>`}))).toBe('multiple-job-postings')
  })
  it('reports distinct visible title and employer evidence failures', async () => {
    expect(await failedDiagnostic(page({showTitle:false}))).toBe('title-missing')
    expect(await failedDiagnostic(page({visibleTitle:'Different visible role'}))).toBe('title-mismatch')
    expect(await failedDiagnostic(page({extra:'<h1>Another role</h1>'}))).toBe('multiple-title-candidates')
    expect(await failedDiagnostic(page({visibleTitle:'<span hidden>Senior Engineer</span>', title:'Senior Engineer'}))).toBe('title-hidden')
    expect(await failedDiagnostic(page({showEmployer:false}))).toBe('employer-missing')
    expect(await failedDiagnostic(page({visibleEmployer:'Different employer'}))).toBe('employer-mismatch')
    expect(await failedDiagnostic(page({extra:'<div class="company">Other employer</div>'}))).toBe('multiple-employer-candidates')
    expect(await failedDiagnostic(page({visibleEmployer:'<span hidden>Example Systems</span>', employer:'Example Systems'}))).toBe('employer-hidden')
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
    expect(await failedDiagnostic(clean.replace('<h1>Senior Engineer</h1>', '<h1 hidden>Senior Engineer</h1>'))).toBe('title-hidden')
    expect(await failedDiagnostic(clean.replace('<h1>Senior Engineer</h1>', '<section aria-hidden="true"><h1>Senior Engineer</h1></section>'))).toBe('title-hidden')
    expect(await failedDiagnostic(clean.replace('<h1>Senior Engineer</h1>', '<h1 style="display:none">Senior Engineer</h1>'))).toBe('title-hidden')
    expect(await failedDiagnostic(clean.replace('<h1>Senior Engineer</h1>', '<h1 inert>Senior Engineer</h1>'))).toBe('title-hidden')
    expect(await failedDiagnostic(clean.replace('<h1>Senior Engineer</h1>', '<h1 class="sr-only">Senior Engineer</h1>'))).toBe('title-hidden')
    expect(await failedDiagnostic(clean.replace('<div class="company-name">Example Systems</div>', '<div class="company-name" style="visibility:hidden">Example Systems</div>'))).toBe('employer-hidden')
    expect(await failedDiagnostic(clean.replace('<div class="company-name">Example Systems</div>', '<div class="company-name d-none">Example Systems</div>'))).toBe('employer-hidden')
    expect(await failedDiagnostic(clean.replace('<div class="company-name">Example Systems</div>', '<div hidden><div class="company-name">Example Systems</div></div>'))).toBe('employer-hidden')
  })
  it('diagnoses missing, unsafe, teaser and non-visible posting descriptions', async () => {
    expect(await failedDiagnostic(page({description:''}))).toBe('description-missing')
    expect(await failedDiagnostic(page({description:'Short teaser'}))).toBe('description-too-short')
    expect(await failedDiagnostic(page({description:`<p>${'Complete-looking posting text. '.repeat(10)}<script>hidden instructions</script></p>`}))).toBe('description-active-content')
    expect(await failedDiagnostic(page({description:'<p>Some essential-looking source text that is not visibly in the document and therefore cannot be confirmed on the page.</p>',renderDescription:false}))).toBe('description-not-visible')
    expect(await failedDiagnostic(page({description:`<p>${'Complete role content. '.repeat(10)} Read more`}))).toBe('description-teaser')
  })
  it('separates source transport failures from bounded parser failures', async () => {
    const networkFailure = await run(page(), { request:async()=>{throw new Error('socket reset')} })
    expect(networkFailure.attempt).toMatchObject({status:'failed',reason:'source-error'})
    expect(networkFailure.attempt.status === 'failed' && networkFailure.attempt.diagnostic).toBeUndefined()
    const malformedUtf8 = await run(page(), { request:async()=>({status:200,headers:{'content-type':'text/html'},body:Buffer.from([0xff,0xfe])}) })
    expect(malformedUtf8.attempt).toMatchObject({status:'failed',reason:'incomplete',diagnostic:'html-invalid'})
  })
  it('rejects unsafe DNS targets and redirects without fallback', async () => {
    expect((await run(page(), {lookup:async()=>[{address:'127.0.0.1',family:4}]})).attempt).toMatchObject({status:'failed',reason:'unsafe-address'})
    expect((await run(page(), {request:async()=>({status:302,headers:{location:'https://evil.example'},body:Buffer.alloc(0)})})).attempt).toMatchObject({status:'failed',reason:'unsafe-redirect'})
  })
})
