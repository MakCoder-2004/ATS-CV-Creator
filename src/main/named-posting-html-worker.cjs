const { parentPort, workerData } = require('node:worker_threads')
const parse5 = require('parse5')
const SKIP = new Set(['script','style','noscript','iframe','svg','template'])

function extract(html) {
  if (Buffer.byteLength(html, 'utf8') > 512 * 1024) throw new Error('HTML section exceeds byte limit.')
  let marks = 0
  for (let i = 0; i < html.length; i++) if (html.charCodeAt(i) === 60 && ++marks > 30_000) throw new Error('HTML complexity exceeds token limit.')
  const errors = []
  const root = parse5.parseFragment(html, { sourceCodeLocationInfo: true, onParseError: error => errors.push(error) })
  if (errors.length) throw new Error('Malformed HTML section.')
  const parts = [], stack = [{ node: root, depth: 0 }]
  let count = 0
  while (stack.length) {
    const { node, depth } = stack.pop()
    if (++count > 50_000 || depth > 96) throw new Error('HTML tree exceeds structural limits.')
    if (SKIP.has(node.tagName)) {
      if (!node.sourceCodeLocation?.endTag) throw new Error('Unclosed unsafe HTML element.')
      continue
    }
    if (node.nodeName === '#text') { parts.push(node.value); continue }
    if (['br','p','div','li','h1','h2','h3','h4','h5','h6','section','article'].includes(node.tagName)) parts.push('\n')
    for (let i = (node.childNodes || []).length - 1; i >= 0; i--) stack.push({ node: node.childNodes[i], depth: depth + 1 })
  }
  return parts.join('').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

try {
  if (!Array.isArray(workerData.sections) || workerData.sections.length > 202 || workerData.sections.reduce((n, s) => n + Buffer.byteLength(s, 'utf8'), 0) > 512 * 1024) throw new Error('HTML input exceeds aggregate limits.')
  parentPort.postMessage({ text: workerData.sections.map(extract) })
} catch (error) {
  parentPort.postMessage({ error: error instanceof Error ? error.message : 'HTML extraction failed.' })
}
