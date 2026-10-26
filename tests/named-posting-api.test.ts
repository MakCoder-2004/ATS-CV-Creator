import { describe, expect, it, vi } from 'vitest'
import { fetchNamedPostingApi } from '../src/main/named-posting-api'

const ref = (source: 'lever'|'greenhouse') => source === 'lever'
  ? { source, board:'acme', postingId:'role1', submittedUrl:'https://jobs.lever.co/acme/role1', canonicalUrl:'https://jobs.lever.co/acme/role1' }
  : { source, board:'acme', postingId:'123', submittedUrl:'https://boards.greenhouse.io/acme/jobs/123', canonicalUrl:'https://boards.greenhouse.io/acme/jobs/123' }
const long = 'We are looking for a thoughtful engineer to work across product systems, collaborate with a diverse team, and deliver reliable software for our customers. '.repeat(2)
const grant = (source: 'lever'|'greenhouse') => ({ personalLocalOptIn:true as const, source, scope:'personal-local' as const, optedInAt:'2026-01-01T00:00:00.000Z' })
const run = async (source:'lever'|'greenhouse', body:any, overrides:any={}) => fetchNamedPostingApi(ref(source), { eligibility:grant(source), now:()=>Date.parse('2026-01-02T00:00:00Z'), lookup:async()=>[{address:'8.8.8.8',family:4}], request:async()=>({status:200,headers:{'content-type':'application/json'},body:Buffer.from(JSON.stringify(body))}), ...overrides })
const lever = () => ({ id:'role1', text:'Engineer', descriptionPlain:long, hostedUrl:'https://jobs.lever.co/acme/role1' })
const greenhouse = () => ({ id:123, title:'Engineer', company_name:'Acme', content:`<h2>Role</h2><p>${long}</p><script>ignore this script</script>`, updated_at:'2026-01-01T00:00:00Z', absolute_url:'https://boards.greenhouse.io/acme/jobs/123' })

describe('inert named public API adapter', () => {
  it('retrieves both exact named public API records with app-issued provenance and TTL', async () => {
    for (const [source, body, method] of [['lever',lever(),'lever-postings-api-v0'],['greenhouse',greenhouse(),'greenhouse-job-board-api-v1']] as const) {
      const result=await run(source,body); expect(result.candidate?.retrievalMethod).toBe(method); expect(result.attempt.status).toBe('retrieved'); if(result.attempt.status==='retrieved') expect(Date.parse(result.attempt.expiresAt)-Date.parse(result.attempt.startedAt)).toBe(600000)
    }
  })
  it('fails closed for mismatch, malformed, login, redirects, unsafe DNS and oversized response', async () => {
    expect((await run('lever',{...lever(),id:'wrong'})).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
    expect((await run('greenhouse',{...greenhouse(),absolute_url:'https://boards.greenhouse.io/other/jobs/123'})).attempt).toMatchObject({status:'failed',reason:'ambiguous'})
    expect((await run('lever',null)).attempt.status).toBe('failed')
    expect((await run('lever',lever(),{request:async()=>({status:302,headers:{location:'https://evil.test'},body:Buffer.alloc(0)})})).attempt).toMatchObject({status:'failed',reason:'unsafe-redirect'})
    expect((await run('lever',lever(),{lookup:async()=>[{address:'127.0.0.1',family:4}]})).attempt).toMatchObject({status:'failed',reason:'unsafe-address'})
    expect((await run('lever',lever(),{request:async()=>({status:200,headers:{'content-type':'application/json'},body:Buffer.alloc(2*1024*1024+1)})})).attempt.status).toBe('failed')
  })
  it('does not fetch without trusted source-specific opt-in and reports HTTP access limits', async () => {
    const request=vi.fn(); expect((await fetchNamedPostingApi(ref('lever'),{request,now:()=>Date.parse('2026-01-02T00:00Z')})).attempt).toMatchObject({status:'failed',reason:'opt-in-required'}); expect(request).not.toHaveBeenCalled()
    expect((await run('lever',lever(),{request:async()=>({status:403,headers:{},body:Buffer.alloc(0)})})).attempt).toMatchObject({status:'failed',reason:'login-required'})
  })
  it('sanitizes HTML text and honors cancellation', async () => {
    const result=await run('greenhouse',greenhouse()); expect(result.candidate?.text).not.toContain('ignore this script')
    const controller=new AbortController(); controller.abort(); expect((await run('lever',lever(),{signal:controller.signal})).attempt).toMatchObject({status:'failed',reason:'cancelled'})
    const timed=new AbortController(); const pending=run('lever',lever(),{signal:timed.signal,request:()=>new Promise(()=>{})}); setTimeout(()=>timed.abort(new Error('deadline')),5); expect((await pending).attempt).toMatchObject({status:'failed',reason:'cancelled'})
  })
})
