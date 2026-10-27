import { describe, expect, it, vi } from 'vitest'
import { fetchNamedPostingApi } from '../src/main/named-posting-api'

const ref = (source: 'lever'|'greenhouse') => source === 'lever'
  ? { source, board:'acme', postingId:'role1', submittedUrl:'https://jobs.lever.co/acme/role1', canonicalUrl:'https://jobs.lever.co/acme/role1' }
  : { source, board:'acme', postingId:'123', submittedUrl:'https://boards.greenhouse.io/acme/jobs/123', canonicalUrl:'https://boards.greenhouse.io/acme/jobs/123' }
const long = 'We are looking for a thoughtful engineer to work across product systems, collaborate with a diverse team, and deliver reliable software for our customers. '.repeat(2)
const grant = (source: 'lever'|'greenhouse') => ({ personalLocalOptIn:true as const, source, scope:'personal-local' as const, optedInAt:'2026-01-01T00:00:00.000Z' })
const run = async (source:'lever'|'greenhouse', body:any, overrides:any={}) => fetchNamedPostingApi(ref(source), { eligibility:grant(source), now:()=>Date.parse('2026-01-02T00:00:00Z'), lookup:async()=>[{address:'8.8.8.8',family:4}], request:async()=>({status:200,headers:{'content-type':'application/json'},body:Buffer.from(JSON.stringify(body))}), ...overrides })
const lever = () => ({ id:'role1', text:'Engineer', descriptionPlain:long, hostedUrl:'https://jobs.lever.co/acme/role1' })
const greenhouse = () => ({ id:123, title:'Engineer', company_name:'Acme', content:`<h2>Role</h2><p>${long}</p><script>ignore this script</script>`, updated_at:'2026-01-01T00:00:00Z', absolute_url:'http://careers.acme.example/opening/123' })
const leverWithSections = () => ({ ...lever(), descriptionPlain:'Opening overview and responsibilities.', lists:[{text:'Qualifications',content:'Experience delivering robust applications across the stack and collaborating with colleagues.'}], additionalPlain:'Additional information about the hiring process.' })

describe('inert named public API adapter', () => {
  it('retrieves both exact named public API records with app-issued provenance and TTL', async () => {
    for (const [source, body, method] of [['lever',leverWithSections(),'lever-postings-api-v0'],['greenhouse',greenhouse(),'greenhouse-job-board-api-v1']] as const) {
      const result=await run(source,body); expect(result.candidate?.retrievalMethod).toBe(method); expect(result.attempt.status).toBe('retrieved'); if(result.attempt.status==='retrieved') expect(Date.parse(result.attempt.expiresAt)-Date.parse(result.attempt.startedAt)).toBe(600000)
      if (source === 'lever') expect(result.candidate?.text).toContain('Qualifications')
      else expect(result.candidate?.returnedBoard).toBeNull()
    }
  })
  it('fails closed for mismatch, malformed, login, redirects, unsafe DNS and oversized response', async () => {
    expect((await run('lever',{...lever(),id:'wrong'})).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
    expect((await run('greenhouse',{...greenhouse(),id:124})).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
    expect((await run('greenhouse',{...greenhouse(),gh_jid:124})).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
    expect((await run('greenhouse',{...greenhouse(),absolute_url:'http://careers.acme.example/opening/123?gh_jid=124'})).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
    expect((await run('lever',{...lever(),hostedUrl:'https://jobs.lever.co/other/role1'})).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
    expect((await run('lever',{...lever(),descriptionPlain:'',description:'<script>hostile but unclosed content'})).attempt.status).toBe('failed')
    expect((await run('lever',null)).attempt.status).toBe('failed')
    expect((await run('lever',lever(),{request:async()=>({status:302,headers:{location:'https://evil.test'},body:Buffer.alloc(0)})})).attempt).toMatchObject({status:'failed',reason:'unsafe-redirect'})
    expect((await run('lever',lever(),{lookup:async()=>[{address:'127.0.0.1',family:4}]})).attempt).toMatchObject({status:'failed',reason:'unsafe-address'})
    expect((await run('lever',lever(),{request:async()=>({status:200,headers:{'content-type':'application/json'},body:Buffer.alloc(2*1024*1024+1)})})).attempt.status).toBe('failed')
  })
  it('bounds the paused Lever named adapter seam: exact host, pinned address, one request, and socket failure', async () => {
    const request = vi.fn(async (_url: URL, _address: { address: string; family: number }, _signal: AbortSignal, _headers: Readonly<Record<string, string>>) => { throw new Error('synthetic socket closed') })
    const lookup = vi.fn(async (host: string) => {
      expect(host).toBe('api.lever.co')
      return [{ address: '8.8.8.8', family: 4 }]
    })
    const result = await fetchNamedPostingApi(ref('lever'), { eligibility: grant('lever'), now: () => Date.parse('2026-01-02T00:00:00Z'), lookup, request })
    expect(result.attempt).toMatchObject({ status: 'failed', reason: 'source-error' })
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0].href).toBe('https://api.lever.co/v0/postings/acme/role1')
    expect(request.mock.calls[0][1]).toEqual({ address: '8.8.8.8', family: 4 })
  })
  it('does not fetch without trusted source-specific opt-in and reports HTTP access limits', async () => {
    const request=vi.fn(), lookup=vi.fn(async()=>[{address:'8.8.8.8',family:4}]);
    for (const optedInAt of ['bogus', 'January 1, 2026']) {
      expect((await fetchNamedPostingApi(ref('lever'),{request,lookup,now:()=>Date.parse('2026-01-02T00:00Z'),eligibility:{...grant('lever'),optedInAt}})).attempt).toMatchObject({status:'failed',reason:'opt-in-required'})
    }
    expect(request).not.toHaveBeenCalled(); expect(lookup).not.toHaveBeenCalled()
    expect((await run('lever',lever(),{request:async()=>({status:429,headers:{},body:Buffer.alloc(0)})})).attempt).toMatchObject({status:'failed',reason:'source-error'})
    expect((await run('lever',lever(),{request:async()=>({status:403,headers:{},body:Buffer.alloc(0)})})).attempt).toMatchObject({status:'failed',reason:'login-required'})
  })
  it('preserves literal angle brackets in Lever plain fields while parsing only HTML sections', async () => {
    const result = await run('lever', { ...lever(), descriptionPlain: `${long} We teach <script>alert(1)</script> safely.`, lists: [{ text: '<React> skills', content: '<p>Build reliable applications.</p>' }], additionalPlain: 'Additional <React> examples are welcome.' })
    expect(result.attempt.status).toBe('retrieved')
    expect(result.candidate?.text).toContain('We teach <script>alert(1)</script> safely.')
    expect(result.candidate?.text).toContain('<React> skills')
    expect(result.candidate?.text).toContain('Additional <React> examples are welcome.')
    expect(result.candidate?.text).toContain('Build reliable applications.')
    const closing = await run('lever', { ...lever(), additionalPlain: ' ', additional: '<p>Additional closing requirements.</p>' })
    expect(closing.attempt.status).toBe('retrieved')
    expect(closing.candidate?.text).toContain('Additional closing requirements.')
    expect((await run('lever', { ...lever(), lists: [{ text: '', content: '<p>Hidden requirement</p>' }] })).attempt.status).toBe('failed')
  })
  it('sanitizes HTML text and rejects unsafe or over-complex hidden suffixes', async () => {
    const result=await run('greenhouse',greenhouse()); expect(result.candidate?.text).not.toContain('ignore this script')
    const prefix = `<p>${long}</p>`
    for (const tag of ['script','style','iframe']) {
      const unsafe = await run('greenhouse',{...greenhouse(),content:`${prefix}<${tag}>hidden unsafe tail`})
      expect(unsafe.attempt).toMatchObject({status:'failed',reason:'source-error'})
    }
    const deep = await run('greenhouse',{...greenhouse(),content:`${'<div>'.repeat(120)}${long}${'</div>'.repeat(120)}`})
    expect(deep.attempt).toMatchObject({status:'failed',reason:'source-error'})
    const withAdditional = await run('lever',{...lever(),descriptionPlain:long,additional:'<p>Extra employer-provided hiring details are important and should not disappear from the captured posting.</p>'})
    expect(withAdditional.candidate?.text).toContain('Extra employer-provided hiring details')
    const controller=new AbortController(); controller.abort(); expect((await run('lever',lever(),{signal:controller.signal})).attempt).toMatchObject({status:'failed',reason:'cancelled'})
    const timed=new AbortController(); const pending=run('lever',lever(),{signal:timed.signal,request:()=>new Promise(()=>{})}); setTimeout(()=>timed.abort(new Error('deadline')),5); expect((await pending).attempt).toMatchObject({status:'failed',reason:'cancelled'})
    const syncAbort=new AbortController(); const late=run('lever',lever(),{signal:syncAbort.signal,request:()=>{syncAbort.abort(); return Promise.reject(new Error('late rejection'))}}); expect((await late).attempt).toMatchObject({status:'failed',reason:'cancelled'})
  })
})
