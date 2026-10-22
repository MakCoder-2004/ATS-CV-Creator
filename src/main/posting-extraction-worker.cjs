const { parentPort, workerData } = require('node:worker_threads')

function htmlToText(html) {
  const parts = []
  let position = 0
  while (position < html.length) {
    if (html[position] !== '<') {
      const nextTag = html.indexOf('<', position)
      const end = nextTag < 0 ? html.length : nextTag
      parts.push(html.slice(position, end))
      position = end
      continue
    }
    const end = html.indexOf('>', position + 1)
    if (end < 0) { parts.push(html.slice(position)); break }
    const tag = html.slice(position + 1, end).trim().toLowerCase()
    if (/^h[1-6](?:\s|$)/.test(tag)) parts.push('\n\n')
    else if (/^\/h[1-6](?:\s|$)/.test(tag)) parts.push('\n')
    else if (/^li(?:\s|$)/.test(tag)) parts.push('\n• ')
    else if (/^\/(?:p|div|section|article|li)(?:\s|$)/.test(tag) || /^br(?:\s|$)/.test(tag)) parts.push('\n')
    position = end + 1
  }
  return parts.join('').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
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

function extract(text, expectedId) {
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
  return { title, company, description, notices }
}

try {
  parentPort.postMessage({ value: extract(workerData.text, workerData.expectedId) })
} catch (error) {
  parentPort.postMessage({ error: error instanceof Error ? error.message : 'The posting source could not be safely extracted.' })
}
