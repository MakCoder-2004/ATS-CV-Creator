const { parentPort, workerData } = require('node:worker_threads')
const parse5 = require('parse5')
const MAX_BYTES = 2 * 1024 * 1024
const HIDDEN_CLASSES = new Set(['hidden','hide','is-hidden','d-none','visually-hidden','sr-only','screen-reader-only','screenreader-only','u-hidden','u-visually-hidden'])
function isHidden(node) {
  let current = node, depth = 0
  while (current && depth++ < 128) {
    const attrs = new Map((current.attrs || []).map(attr => [attr.name.toLowerCase(), attr.value]))
    if (attrs.has('hidden') || attrs.has('inert') || String(attrs.get('aria-hidden') || '').trim().toLowerCase() === 'true') return true
    const classes = String(attrs.get('class') || '').toLowerCase().split(/\s+/)
    if (classes.some(name => HIDDEN_CLASSES.has(name))) return true
    const style = String(attrs.get('style') || '').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const item of style.split(';')) {
      const split = item.indexOf(':')
      if (split < 0) continue
      const name = item.slice(0, split).trim().toLowerCase()
      const value = item.slice(split + 1).replace(/!important\s*$/i, '').trim().toLowerCase()
      if (name === 'display' && value === 'none' || name === 'visibility' && ['hidden','collapse'].includes(value) || name === 'content-visibility' && value === 'hidden' || name === 'opacity' && Number(value) === 0) return true
    }
    current = current.parentNode
  }
  return !!current
}
function text(node, out = []) {
  if (node.nodeName === '#text') out.push(node.value)
  if (['br','p','div','li','h1','h2','h3','h4','section','article'].includes(node.tagName)) out.push('\n')
  for (const child of node.childNodes || []) text(child, out)
  return out
}
const joinedText = node => text(node).join('')
function visibleText(root, out = []) {
  if (isHidden(root) || ['script','style','noscript','iframe','svg','template'].includes(root.tagName)) return out
  if (root.nodeName === '#text') out.push(root.value)
  if (['br','p','div','li','h1','h2','h3','h4','section','article'].includes(root.tagName)) out.push('\n')
  for (const child of root.childNodes || []) visibleText(child, out)
  return out
}
function values(root) {
  const out = [], stack = [root]
  while (stack.length) { if (out.length >= 50_000) throw new Error('Wuzzuf HTML complexity exceeds node limit.'); const node = stack.pop(); out.push(node); for (const child of node.childNodes || []) stack.push(child); if (node.content) stack.push(node.content) }
  return out
}
try {
  const html = workerData.html
  if (Buffer.byteLength(html, 'utf8') > MAX_BYTES) throw new Error('Wuzzuf page exceeds parser limit.')
  const errors = [], doc = parse5.parse(html, { sourceCodeLocationInfo: true, onParseError: e => errors.push(e) })
  const nodes = values(doc)
  const canonicalNodes = nodes.flatMap(n => n.tagName === 'link' && n.attrs?.some(a => a.name === 'rel' && a.value.toLowerCase().split(/\s+/).includes('canonical')) ? n.attrs.filter(a => a.name === 'href').map(a => a.value) : [])
  const jobs = []
  function addJob(v) {
    if (!v || typeof v !== 'object') return
    const type = Array.isArray(v['@type']) ? v['@type'] : [v['@type']]
    if (type.includes('JobPosting')) jobs.push(v)
    if (Array.isArray(v['@graph'])) v['@graph'].forEach(addJob)
    if (Array.isArray(v)) v.forEach(addJob)
  }
  for (const n of nodes) if (n.tagName === 'script' && n.attrs?.some(a => a.name === 'type' && a.value.toLowerCase().includes('ld+json'))) {
    const raw = joinedText(n).trim()
    if (!raw || raw.length > 512 * 1024) continue
    try { addJob(JSON.parse(raw)) } catch { /* malformed structured-data blocks do not become candidates */ }
  }
  const canonicals = [...new Set(canonicalNodes.map(x => { try { const u = new URL(x, workerData.url); return u.protocol === 'https:' && u.hostname === 'wuzzuf.net' && !u.username && !u.password && !u.port && !u.search && !u.hash && /^\/jobs\/p\/[A-Za-z0-9_-]{8,160}\/?$/.test(u.pathname) ? `https://wuzzuf.net${u.pathname.replace(/\/$/, '')}` : '' } catch { return '' } }).filter(Boolean))]
  if (jobs.length !== 1 || canonicals.length !== 1 || canonicals[0] !== workerData.canonicalUrl) throw new Error('Wuzzuf posting identity is ambiguous or does not uniquely match the selected canonical URL.')
  const titleEvidence = nodes.filter(n => n.tagName === 'h1')
  if (titleEvidence.length !== 1 || isHidden(titleEvidence[0])) throw new Error('Visible title evidence is missing, hidden, or ambiguous.')
  const employerEvidence = nodes.filter(n => n.attrs?.some(a => a.name === 'class' && a.value.toLowerCase().split(/\s+/).some(token => ['company-name','companyname','company-name-link','company'].includes(token)) || a.name === 'data-testid' && /company/i.test(a.value)))
  if (employerEvidence.length !== 1 || isHidden(employerEvidence[0])) throw new Error('Visible employer evidence is missing, hidden, or ambiguous.')
  const visibleTitle = joinedText(titleEvidence[0]).replace(/\s+/g, ' ').trim()
  const visibleEmployerNode = employerEvidence[0]
  const visibleEmployer = joinedText(visibleEmployerNode).replace(/\s+/g, ' ').trim()
  const job = jobs[0]
  const title = typeof job.title === 'string' ? job.title.trim() : ''
  const employer = typeof job.hiringOrganization?.name === 'string' ? job.hiringOrganization.name.trim() : ''
  const normalize = x => x.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en')
  if (!visibleTitle || !visibleEmployer || !title || !employer || normalize(title) !== normalize(visibleTitle) || normalize(employer) !== normalize(visibleEmployer)) throw new Error('Visible title and employer must independently match the structured posting.')
  const description = typeof job.description === 'string' ? job.description : ''
  if (!description || description.length > 100000) throw new Error('The complete posting text is missing or exceeds the supported limit.')
  const descRoot = parse5.parseFragment(description, { sourceCodeLocationInfo: true, onParseError: e => errors.push(e) })
  if (values(descRoot).some(n => ['script','style','noscript','iframe','svg','template'].includes(n.tagName))) throw new Error('Posting description contains embedded active content.')
  const fullText = joinedText(descRoot).replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const rendered = visibleText(doc).join('').replace(/\s+/g, ' ').trim().normalize('NFKC').toLocaleLowerCase('en')
  const fullNormalized = fullText.replace(/\s+/g, ' ').trim().normalize('NFKC').toLocaleLowerCase('en')
  if (fullText.length < 80 || /apply now|view more|read more/i.test(fullText.slice(-100)) || !rendered.includes(fullNormalized)) throw new Error('Posting text is partial, teaser-only, or not visibly corroborated.')
  parentPort.postMessage({ title, employer, text: fullText, canonicalUrl: canonicals[0], visibleTitle, visibleEmployer })
} catch (e) { parentPort.postMessage({ error: e instanceof Error ? e.message : 'Wuzzuf extraction failed.' }) }
