const { parentPort, workerData } = require('node:worker_threads')
const parse5 = require('parse5')

const MAX_HTML_NODES = 100_000
const MAX_HTML_DEPTH = 256
const IGNORED_HTML_TAGS = new Set(['script', 'style', 'nav', 'footer', 'aside', 'form', 'button', 'noscript'])

function fragmentText(root, { format = true, ignorePageNoise = true } = {}) {
  const output = [], stack = [{ node: root, depth: 0, closing: false }]
  let nodes = 0
  while (stack.length) {
    const { node, depth, closing } = stack.pop()
    if (depth > MAX_HTML_DEPTH) throw new Error('HTML content is nested too deeply to review safely.')
    if (++nodes > MAX_HTML_NODES) throw new Error('HTML content contains too many nodes to review safely.')
    if (closing) {
      if (format && /^(p|div|section|article|li|h[1-6])$/.test(node.tagName || '')) output.push('\n')
      continue
    }
    if (node.nodeName === '#text') { output.push(node.value); continue }
    const tag = node.tagName || ''
    if (ignorePageNoise && IGNORED_HTML_TAGS.has(tag)) continue
    if (format && /^h[1-6]$/.test(tag)) output.push('\n\n')
    if (format && tag === 'li') output.push('\n• ')
    if (format && tag === 'br') output.push('\n')
    if (node.childNodes?.length && /^(p|div|section|article|li|h[1-6])$/.test(tag)) stack.push({ node, depth, closing: true })
    for (let index = (node.childNodes || []).length - 1; index >= 0; index--) stack.push({ node: node.childNodes[index], depth: depth + 1, closing: false })
  }
  return output.join('').replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function htmlToText(html) {
  return fragmentText(parse5.parseFragment(html))
}

function listItems(content, remaining) {
  const lower = content.toLowerCase()
  const items = []
  let position = 0, itemStart = -1
  while (position < lower.length) {
    const open = lower.indexOf('<li', position)
    const close = lower.indexOf('</li', position)
    if (open < 0 && close < 0) break
    if (open >= 0 && (close < 0 || open < close)) {
      const boundary = lower[open + 3]
      if (boundary !== '>' && !/\s/.test(boundary ?? '')) { position = open + 3; continue }
      const tagEnd = lower.indexOf('>', open + 3)
      if (tagEnd < 0) break
      if (itemStart < 0) itemStart = tagEnd + 1
      position = tagEnd + 1
      continue
    }
    const boundary = lower[close + 4]
    if (boundary !== '>' && !/\s/.test(boundary ?? '')) { position = close + 4; continue }
    const tagEnd = lower.indexOf('>', close + 4)
    if (tagEnd < 0) break
    if (itemStart >= 0) {
      if (items.length >= remaining) throw new Error('The posting response contains too many list items to review safely.')
      const value = htmlToText(content.slice(itemStart, close)).replace(/\s+/g, ' ').trim()
      if (value) items.push(value)
      itemStart = -1
    }
    position = tagEnd + 1
  }
  if (itemStart >= 0) throw new Error('The source contains a malformed structured posting list; use the manual text fallback.')
  return items
}

function extractHtml(text) {
  const document = parse5.parse(text)
  const elements = [], stack = [{ node: document, depth: 0 }]
  let nodeCount = 0
  while (stack.length) {
    const { node, depth } = stack.pop()
    if (depth > MAX_HTML_DEPTH) throw new Error('The posting page markup is nested too deeply to review safely.')
    if (++nodeCount > MAX_HTML_NODES) throw new Error('The posting page contains too many nodes to review safely.')
    if (node.tagName) elements.push(node)
    for (let index = (node.childNodes || []).length - 1; index >= 0; index--) stack.push({ node: node.childNodes[index], depth: depth + 1 })
  }
  const attr = (node, name) => node.attrs?.find(value => value.name === name)?.value || ''
  const textContent = node => fragmentText(node, { format: false, ignorePageNoise: false })
  const collectJobPostings = (value, depth = 0) => {
    if (depth > 64) throw new Error('The structured posting data exceeds the safe nesting limit.')
    if (Array.isArray(value)) return value.flatMap(item => collectJobPostings(item, depth + 1))
    if (!value || typeof value !== 'object') return []
    if (value['@type'] === 'JobPosting' || Array.isArray(value['@type']) && value['@type'].includes('JobPosting')) return [value]
    return Array.isArray(value['@graph']) ? value['@graph'].flatMap(item => collectJobPostings(item, depth + 1)) : []
  }
  const jsonBlocks = elements.filter(node => node.tagName === 'script' && attr(node, 'type').toLowerCase() === 'application/ld+json').flatMap(node => {
    try { return collectJobPostings(JSON.parse(textContent(node))) } catch { throw new Error('The page contains malformed structured posting data; use the manual text fallback.') }
  })
  if (jsonBlocks.length > 1) throw new Error('The page describes multiple roles and cannot be selected safely.')
  const posting = jsonBlocks[0] || null
  const articles = elements.filter(node => node.tagName === 'article' && (['posting','job-description'].some(name => attr(node, 'class').split(/\s+/).includes(name)) || attr(node, 'id') === 'posting'))
  const visibleArticle = articles.length === 1 ? articles[0] : null
  const visible = node => fragmentText(node)
  const visibleTitleNode = elements.find(node => node.tagName === 'h1')
  const visibleCompanyNode = elements.find(node => attr(node, 'class').split(/\s+/).includes('company'))
  const visibleTitleValue = visibleTitleNode ? textContent(visibleTitleNode).trim() : ''
  const visibleCompanyValue = visibleCompanyNode ? textContent(visibleCompanyNode).trim() : ''
  const title = (typeof posting?.title === 'string' ? posting.title.trim() : '') || visibleTitleValue
  const company = (typeof posting?.hiringOrganization?.name === 'string' ? posting.hiringOrganization.name.trim() : '') || visibleCompanyValue || null
  const structured = typeof posting?.description === 'string' ? fragmentText(parse5.parseFragment(posting.description), { format: false }).replace(/\s+/g,' ').trim() : ''
  const description = visibleArticle ? visible(visibleArticle).replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim() : ''
  if (!visibleArticle || !title || !company || !description || [...description].length < 100) throw new Error('The page is incomplete or lacks the supported single-posting detail shape; use the manual text fallback.')
  const notices = [`Extracted from ${posting ? 'inert Lever-hosted JobPosting JSON-LD and readable static text' : 'the supported Lever-hosted static posting article'}; scripts and linked content were not executed or fetched. Review all wording; completeness and vacancy status are not guaranteed.`]
  const conflicts = []
  if (posting && visibleTitleValue && visibleTitleValue !== title) conflicts.push('title')
  if (posting && visibleCompanyValue && visibleCompanyValue !== company) conflicts.push('company')
  const normalizeWording = value => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  if (structured && normalizeWording(structured) !== normalizeWording(description)) conflicts.push('description')
  if (conflicts.length) notices.push(`Unresolved source conflict: structured metadata and readable page disagree on ${conflicts.join(', ')}. Paste or correct the posting text manually; it cannot be saved as-is.`)
  return { title, company, description, notices, extractionMethod: posting ? 'lever-html-jsonld-v1' : 'lever-html-static-v1' }
}

function extract(text, expectedId) {
  if (workerData.mode === 'html') return extractHtml(text)
  let depth = 0, quoted = false, escaped = false
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === '{' || char === '[') {
      if (++depth > 64) throw new Error('The posting JSON exceeds the safe nesting limit.')
    } else if (char === '}' || char === ']') depth--
  }
  const data = JSON.parse(text)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The posting response was not valid posting JSON.')
  if (data.id !== expectedId) throw new Error('The source response did not match the requested posting.')

  const title = typeof data.text === 'string' ? data.text.trim() : ''
  const company = typeof data.company === 'string' && data.company.trim() ? data.company.trim() : null
  const segments = [], segmentSet = new Set()
  const addSegment = value => {
    if (typeof value !== 'string' || !value.trim()) return
    const normalized = value.trim()
    if (!segmentSet.has(normalized)) { segments.push(normalized); segmentSet.add(normalized) }
  }
  addSegment(typeof data.descriptionPlain === 'string' ? data.descriptionPlain : typeof data.description === 'string' ? htmlToText(data.description) : '')
  addSegment(typeof data.openingPlain === 'string' ? data.openingPlain : typeof data.opening === 'string' ? htmlToText(data.opening) : '')
  addSegment(typeof data.descriptionBodyPlain === 'string' ? data.descriptionBodyPlain : typeof data.descriptionBody === 'string' ? htmlToText(data.descriptionBody) : '')
  addSegment(typeof data.additionalPlain === 'string' ? data.additionalPlain : typeof data.additional === 'string' ? htmlToText(data.additional) : '')

  const baseLines = segments.join('\n\n').split('\n')
  const extras = []
  const lineIndex = new Map()
  for (let index = 0; index < baseLines.length; index++) {
    const line = baseLines[index].trim()
    if (line && !lineIndex.has(line)) lineIndex.set(line, index)
  }
  const lists = Array.isArray(data.lists) ? data.lists : []
  if (lists.length > 1_000) throw new Error('The posting response contains too many structured sections to review safely.')
  let bulletCount = 0, malformedSection = false
  for (const value of lists) {
    if (!value || typeof value !== 'object') { malformedSection = true; continue }
    const heading = typeof value.text === 'string' ? htmlToText(value.text).replace(/\s+/g, ' ').trim() : ''
    const hasContent = typeof value.content === 'string'
    if (!hasContent) malformedSection = true
    let items = hasContent ? listItems(value.content, 10_000 - bulletCount) : []
    if (hasContent && !items.length && value.content.trim()) {
      const fallback = htmlToText(value.content)
      if (fallback) items = fallback.split('\n').map(line => line.trim()).filter(Boolean)
    }
    bulletCount += items.length
    if (!items.length) { if (hasContent && value.content.trim()) malformedSection = true; continue }
    if (heading && !lineIndex.has(heading)) { extras.push(heading); lineIndex.set(heading, baseLines.length + extras.length - 1) }
    for (const item of items) {
      const priorIndex = lineIndex.get(item)
      if (priorIndex !== undefined) {
        if (!baseLines[priorIndex]?.trim().startsWith('• ') && priorIndex < baseLines.length) baseLines[priorIndex] = `• ${baseLines[priorIndex].trim()}`
        continue
      }
      const bullet = `• ${item}`
      if (!lineIndex.has(bullet)) { extras.push(bullet); lineIndex.set(bullet, baseLines.length + extras.length - 1) }
    }
  }

  const description = [...baseLines, ...extras].join('\n').trim()
  if ([...title].length > 200 || (company && [...company].length > 200) || [...description].length > 200_000 || Buffer.byteLength(description, 'utf8') > 1024 * 1024) throw new Error('The posting text exceeds the safe preview limit; no partial preview was created.')
  const hasStructuredSections = lists.some(item => item && typeof item === 'object' && typeof item.content === 'string')
  const hasSectionHeadings = /\b(responsibilities|requirements|qualifications|what you(?:'|’)ll do|what we(?:'|’)re looking for)\b/i.test(description)
  const notices = [
    !company ? 'Employer name was not provided by this source; this preview is incomplete.' : '',
    malformedSection ? 'Some structured source sections could not be interpreted; this preview is incomplete.' : '',
    !title ? 'The source did not provide a job title; this preview is incomplete.' : '',
    !description ? 'The source did not provide posting text; this preview is incomplete.' : '',
    [...description].length < 200 || (!hasStructuredSections && !hasSectionHeadings) ? 'The response lacks enough posting-detail structure to establish complete source text; this preview is incomplete.' : ''
  ].filter(Boolean)
  notices.push('Extraction cannot guarantee posting completeness or that the role remains open. Review the full source before relying on it.')
  return { title, company, description, notices, extractionMethod: 'lever-json-v1' }
}

try {
  parentPort.postMessage({ value: extract(workerData.text, workerData.expectedId) })
} catch (error) {
  parentPort.postMessage({ error: error instanceof Error ? error.message : 'The posting source could not be safely extracted.' })
}
