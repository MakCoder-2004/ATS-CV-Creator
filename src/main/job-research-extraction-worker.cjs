const { parentPort, workerData } = require('node:worker_threads')
const parse5 = require('parse5')

function attrs(node, name) { return node.attrs?.find(attr => attr.name === name)?.value || '' }
function walk(root) {
  const nodes = [], stack = [{ node: root, depth: 0 }]
  while (stack.length) {
    const { node, depth } = stack.pop()
    if (depth > 128 || nodes.length > 100_000) throw new Error('HTML exceeds safe parsing limits.')
    if (node.tagName) nodes.push(node)
    for (let i = (node.childNodes || []).length - 1; i >= 0; i--) stack.push({ node: node.childNodes[i], depth: depth + 1 })
  }
  return nodes
}
function content(node) {
  const parts = [], stack = [node]
  let count = 0
  while (stack.length) {
    const current = stack.pop()
    if (++count > 100_000) throw new Error('Posting text exceeds safe parsing limits.')
    if (current.nodeName === '#text') { parts.push(current.value); continue }
    if (['style','script','nav','footer','form','noscript'].includes(current.tagName)) continue
    if (['p','li','div','section','article','br','h1','h2','h3'].includes(current.tagName)) parts.push('\n')
    for (let i = (current.childNodes || []).length - 1; i >= 0; i--) stack.push(current.childNodes[i])
  }
  return parts.join('').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
function roles(value, depth = 0) {
  if (depth > 40) throw new Error('Structured data is too deeply nested.')
  if (Array.isArray(value)) return value.flatMap(item => roles(item, depth + 1))
  if (!value || typeof value !== 'object') return []
  const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']]
  if (types.includes('JobPosting')) return [value]
  return value['@graph'] ? roles(value['@graph'], depth + 1) : []
}
function sourceMatches(value, selected) {
  if (typeof value !== 'string') return false
  try {
    const target = new URL(value), expected = new URL(selected.canonicalUrl)
    if (target.protocol !== 'https:' || target.username || target.password || target.port) return false
    if (selected.roleId && selected.provider === 'linkedin') return /(?:^|\/)jobs\/view\/(?:[a-z0-9-]*-)?(\d{5,20})\/?$/i.exec(target.pathname)?.[1] === selected.roleId && ['linkedin.com','www.linkedin.com'].includes(target.hostname)
    if (selected.roleId && selected.provider === 'indeed') return target.hostname === selected.host && (target.searchParams.get('jk') === selected.roleId || target.searchParams.get('vjk') === selected.roleId)
    target.hash = ''; expected.hash = ''
    return target.href === expected.href
  } catch { return false }
}
function selectedRole(posting, selected) {
  if (sourceMatches(posting.url || posting.mainEntityOfPage?.['@id'] || posting.mainEntityOfPage?.url, selected)) return true
  if (selected.provider === 'linkedin') return String(posting.identifier?.value || posting.identifier || '') === selected.roleId
  return false
}
function extract() {
  const { html, selected } = workerData
  const document = parse5.parse(html)
  const elements = walk(document)
  const visible = content(document).toLowerCase()
  if (/captcha|verify you are human|unusual traffic|sign in to view|log in to view|access denied/i.test(visible)) return { outcome: 'blocked', reason: 'The page requires sign-in, verification or blocks public access.' }
  if (/this job (?:is no longer available|has expired|has closed)|this position has been filled|job posting has expired/i.test(visible)) return { outcome: 'blocked', reason: 'The source says the posting has expired or closed.' }
  const structured = elements.filter(node => node.tagName === 'script' && attrs(node, 'type').toLowerCase() === 'application/ld+json').flatMap(node => {
    try { return roles(JSON.parse((node.childNodes || []).map(child => child.value || '').join(''))) } catch { return [] }
  })
  const exact = structured.filter(item => selectedRole(item, selected))
  if (exact.length > 1 || structured.length > 1 && exact.length !== 1) return { outcome: 'none', reason: 'Multiple roles were found without one exact match.' }
  if (structured.length && !exact.length) return { outcome: 'none', reason: 'Structured data belongs to another role.' }
  const posting = exact[0]
  if (posting?.validThrough && !Number.isNaN(Date.parse(posting.validThrough)) && Date.parse(posting.validThrough) < Date.now()) return { outcome: 'blocked', reason: 'The posting deadline has passed.' }
  const candidates = elements.filter(node => (attrs(node, 'class').split(/\s+/).includes('show-more-less-html__markup') || attrs(node, 'class').split(/\s+/).includes('description__text--rich')))
  const decoratedNodes = elements.filter(node => node.tagName === 'code' && attrs(node, 'id') === 'decoratedJobPostingId')
  const embeddedId = decoratedNodes.length === 1 ? (decoratedNodes[0].childNodes || []).map(node => node.value || node.data || '').join('').trim().replace(/^"|"$/g, '') : ''
  const scriptedId = html.match(/"decoratedJobPostingId"\s*:\s*"(\d{5,20})"/)?.[1] || ''
  if (embeddedId && scriptedId && embeddedId !== scriptedId) return { outcome: 'none', reason: 'Conflicting posting IDs were found.' }
  const decorated = embeddedId || scriptedId
  const linkedInExact = selected.provider === 'linkedin' && /^\d{5,20}$/.test(decorated) && decorated === selected.roleId
  const canonical = elements.filter(node => node.tagName === 'link' && attrs(node, 'rel').toLowerCase() === 'canonical')
  const canonicalExact = canonical.length === 1 && sourceMatches(attrs(canonical[0], 'href'), selected)
  if (canonical.length > 1 || canonical.length === 1 && !canonicalExact) return { outcome: 'none', reason: 'The page canonical identity differs from the selected role.' }
  const exactIdentity = !!posting || linkedInExact || selected.provider !== 'generic' && canonicalExact
  if (!exactIdentity) return { outcome: 'none', reason: 'The page did not prove it describes the selected role.' }
  const linkedinPrimary = selected.provider === 'linkedin' && candidates.length ? candidates.filter(node => attrs(node, 'class').split(/\s+/).includes('show-more-less-html__markup')) : []
  const descriptionNode = linkedinPrimary.length === 1 ? linkedinPrimary[0] : null
  const body = posting && typeof posting.description === 'string' ? content(parse5.parseFragment(posting.description)) : ''
  if (linkedinPrimary.length > 1 || structured.length > 1) return { outcome: 'none', reason: 'The page contains ambiguous role descriptions.' }
  const description = body || (linkedInExact && descriptionNode ? content(descriptionNode) : '')
  const titleNode = elements.filter(node => node.tagName === 'h1' && attrs(node, 'class').split(/\s+/).some(value => value === 'top-card-layout__title' || value === 'topcard__title'))
  const title = typeof posting?.title === 'string' ? posting.title.trim() : titleNode.length === 1 ? content(titleNode[0]) : null
  const employer = typeof posting?.hiringOrganization?.name === 'string' ? posting.hiringOrganization.name.trim() : null
  if (!description || !title || description.length < 80) return { outcome: 'none', reason: 'The selected page lacks a substantive readable job posting.' }
  return { outcome: description.length > 16_000 ? 'partial' : 'full', description: description.slice(0, 16_000), title: title.slice(0, 500), employer: employer?.slice(0, 500) || null }
}
try { parentPort.postMessage(extract()) } catch (error) { parentPort.postMessage({ outcome: 'none', reason: error instanceof Error ? error.message : 'Extraction failed.' }) }
