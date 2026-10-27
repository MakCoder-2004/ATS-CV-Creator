const { parentPort, workerData } = require('node:worker_threads')
const parse5 = require('parse5')
const MAX_BYTES = 2 * 1024 * 1024
const DIAGNOSTICS = new Set([
  'canonical-missing','canonical-multiple','canonical-malformed','canonical-mismatch',
  'structured-data-missing','structured-data-invalid','multiple-job-postings',
  'title-missing','title-hidden','multiple-title-candidates',
  'employer-missing','employer-hidden','multiple-employer-candidates','title-mismatch','employer-mismatch',
  'description-missing','description-over-limit','description-active-content','description-too-short','description-teaser','description-not-visible',
  'html-invalid','html-complexity-limit'
])
const HIDDEN_CLASSES = new Set(['hidden','hide','is-hidden','d-none','visually-hidden','sr-only','screen-reader-only','screenreader-only','u-hidden','u-visually-hidden'])
function fail(diagnostic) { throw { diagnostic } }
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
function hasHiddenDescendant(root) {
  const stack = [...(root.childNodes || [])]
  let visited = 0
  while (stack.length) {
    if (++visited > 50_000) fail('html-complexity-limit')
    const node = stack.pop()
    if (isHidden(node)) return true
    for (const child of node.childNodes || []) stack.push(child)
  }
  return false
}
function values(root) {
  const out = [], stack = [root]
  while (stack.length) { if (out.length >= 50_000) fail('html-complexity-limit'); const node = stack.pop(); out.push(node); for (const child of node.childNodes || []) stack.push(child); if (node.content) stack.push(node.content) }
  return out
}
function addJobPosting(value, jobs, depth = 0) {
  if (!value || typeof value !== 'object') return
  if (depth > 64) fail('html-complexity-limit')
  const type = Array.isArray(value['@type']) ? value['@type'] : [value['@type']]
  if (type.includes('JobPosting')) jobs.push(value)
  if (Array.isArray(value)) value.forEach(item => addJobPosting(item, jobs, depth + 1))
  if (Array.isArray(value['@graph'])) value['@graph'].forEach(item => addJobPosting(item, jobs, depth + 1))
}
function normalizedText(value) { return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en') }
try {
  const html = workerData.html
  if (Buffer.byteLength(html, 'utf8') > MAX_BYTES) fail('html-complexity-limit')
  const parseErrors = [], doc = parse5.parse(html, { sourceCodeLocationInfo: true, onParseError: error => parseErrors.push(error) })
  const nodes = values(doc)

  // Count raw canonical declarations before parsing/filtering them. A malformed extra
  // declaration must not disappear and leave a false unique identity.
  const canonicalNodes = nodes.filter(node => node.tagName === 'link' && node.attrs?.some(attr => attr.name === 'rel' && attr.value.toLowerCase().split(/\s+/).includes('canonical')))
  if (canonicalNodes.length === 0) fail('canonical-missing')
  if (canonicalNodes.length !== 1) fail('canonical-multiple')
  const canonicalHrefs = canonicalNodes[0].attrs.filter(attr => attr.name === 'href')
  if (canonicalHrefs.length !== 1 || !canonicalHrefs[0].value || canonicalHrefs[0].value.trim() !== canonicalHrefs[0].value) fail('canonical-malformed')
  let canonical
  try { canonical = new URL(canonicalHrefs[0].value, workerData.url) } catch { fail('canonical-malformed') }
  if (canonical.protocol !== 'https:' || canonical.hostname !== 'wuzzuf.net' || canonical.username || canonical.password || canonical.port || canonical.search || canonical.hash || !/^\/jobs\/p\/[A-Za-z0-9_-]{8,160}\/?$/.test(canonical.pathname)) fail('canonical-malformed')
  const canonicalUrl = `https://wuzzuf.net${canonical.pathname.replace(/\/$/, '')}`
  if (canonicalUrl !== workerData.canonicalUrl) fail('canonical-mismatch')

  const jobNodes = []
  let malformedStructuredData = false
  for (const node of nodes) if (node.tagName === 'script' && node.attrs?.some(attr => attr.name === 'type' && attr.value.toLowerCase().includes('ld+json'))) {
    const raw = joinedText(node).trim()
    if (!raw || raw.length > 512 * 1024) { malformedStructuredData = true; continue }
    let structured
    try { structured = JSON.parse(raw) } catch { malformedStructuredData = true; continue }
    addJobPosting(structured, jobNodes)
  }
  if (malformedStructuredData) fail('structured-data-invalid')
  if (jobNodes.length === 0) fail('structured-data-missing')
  if (jobNodes.length !== 1) fail('multiple-job-postings')

  const titleEvidence = nodes.filter(node => node.tagName === 'h1')
  if (titleEvidence.length === 0) fail('title-missing')
  if (titleEvidence.length !== 1) fail('multiple-title-candidates')
  if (isHidden(titleEvidence[0]) || hasHiddenDescendant(titleEvidence[0])) fail('title-hidden')
  const employerEvidence = nodes.filter(node => node.attrs?.some(attr => attr.name === 'class' && attr.value.toLowerCase().split(/\s+/).some(token => ['company-name','companyname','company-name-link','company'].includes(token)) || attr.name === 'data-testid' && /company/i.test(attr.value)))
  if (employerEvidence.length === 0) fail('employer-missing')
  if (employerEvidence.length !== 1) fail('multiple-employer-candidates')
  if (isHidden(employerEvidence[0]) || hasHiddenDescendant(employerEvidence[0])) fail('employer-hidden')
  const visibleTitle = visibleText(titleEvidence[0]).join('').replace(/\s+/g, ' ').trim()
  const visibleEmployer = visibleText(employerEvidence[0]).join('').replace(/\s+/g, ' ').trim()
  const job = jobNodes[0]
  const title = typeof job.title === 'string' ? job.title.trim() : ''
  const employer = typeof job.hiringOrganization?.name === 'string' ? job.hiringOrganization.name.trim() : ''
  if (!visibleTitle || !title || normalizedText(title) !== normalizedText(visibleTitle)) fail('title-mismatch')
  if (!visibleEmployer || !employer || normalizedText(employer) !== normalizedText(visibleEmployer)) fail('employer-mismatch')

  const description = typeof job.description === 'string' ? job.description : ''
  if (!description) fail('description-missing')
  if (description.length > 100000) fail('description-over-limit')
  const descRoot = parse5.parseFragment(description, { sourceCodeLocationInfo: true, onParseError: error => parseErrors.push(error) })
  if (values(descRoot).some(node => ['script','style','noscript','iframe','svg','template'].includes(node.tagName))) fail('description-active-content')
  const fullText = joinedText(descRoot).replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (fullText.length < 80) fail('description-too-short')
  if (/apply now|view more|read more/i.test(fullText.slice(-100))) fail('description-teaser')
  const rendered = visibleText(doc).join('').replace(/\s+/g, ' ').trim().normalize('NFKC').toLocaleLowerCase('en')
  const fullNormalized = fullText.replace(/\s+/g, ' ').trim().normalize('NFKC').toLocaleLowerCase('en')
  if (!rendered.includes(fullNormalized)) fail('description-not-visible')
  parentPort.postMessage({ ok:true, title, employer, text:fullText, canonicalUrl })
} catch (error) {
  const diagnostic = error && typeof error === 'object' && DIAGNOSTICS.has(error.diagnostic) ? error.diagnostic : 'html-invalid'
  parentPort.postMessage({ ok:false, diagnostic })
}
