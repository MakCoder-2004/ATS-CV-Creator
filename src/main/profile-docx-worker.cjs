const { parentPort } = require('node:worker_threads')
const { createHash } = require('node:crypto')
const JSZip = require('jszip')
const mammoth = require('mammoth')

const limits = { bytes: 15 * 1024 * 1024, entries: 100, expanded: 50 * 1024 * 1024, part: 20 * 1024 * 1024, codePoints: 500_000 }
const decode = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
parentPort.postMessage({ ready: true })
parentPort.on('message', async bytes => {
  try {
    const captured = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (!captured.length || captured.length > limits.bytes) throw new Error('Choose a non-empty DOCX smaller than 15 MiB.')
    if (captured.subarray(0, 4).toString('hex') !== '504b0304') throw new Error('The selected file is not a DOCX document.')
    const zip = await JSZip.loadAsync(captured, { checkCRC32: true, createFolders: false })
    const files = Object.values(zip.files).filter(file => !file.dir)
    if (!files.length || files.length > limits.entries) throw new Error('DOCX archives may contain no more than 100 files.')
    const names = new Set(); let expanded = 0
    for (const file of files) {
      const name = file.unsafeOriginalName || file.name
      if (names.has(name) || name.startsWith('/') || /^[a-z]:/i.test(name) || name.includes('\\') || name.split('/').includes('..')) throw new Error('The DOCX contains an unsafe or duplicate archive path.')
      names.add(name)
      if (/\.(?:docm|vbaProject\.bin)$/i.test(name) || /vbaProject/i.test(name)) throw new Error('Macro-enabled documents are not supported.')
      expanded += file._data && Number.isFinite(file._data.uncompressedSize) ? file._data.uncompressedSize : 0
      if (expanded > limits.expanded) throw new Error('DOCX expanded content exceeds the 50 MiB limit.')
      if (/\.xml$/i.test(name) && file._data && file._data.uncompressedSize > limits.part) throw new Error('A DOCX XML part exceeds the 20 MiB limit.')
    }
    const xmlParts = files.filter(file => /\.(?:xml|rels)$/i.test(file.name))
    const xml = new Map()
    for (const file of xmlParts) {
      const text = await file.async('string')
      if (text.length > limits.part) throw new Error('A DOCX XML part exceeds the 20 MiB limit.')
      if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(text)) throw new Error('DOCX XML declarations and entities are not supported.')
      if (/<(?:[\w.-]+:)?Relationship\b[^>]*\bTargetMode\s*=\s*['"]External['"][^>]*>/i.test(text) && /relationships\/(?:image|oleObject|package|attachedTemplate)/i.test(text)) throw new Error('External DOCX resources are not supported.')
      if ((text.match(/</g) || []).length > 250_000) throw new Error('DOCX XML contains too many elements.')
      xml.set(file.name, text)
    }
    if (!xml.has('word/document.xml')) throw new Error('The DOCX document body is missing.')
    if (/macroEnabled|vbaProject/i.test(xml.get('[Content_Types].xml') || '')) throw new Error('Macro-enabled documents are not supported.')
    for (const [name, text] of xml) {
      let depth = 0
      for (const tag of text.matchAll(/<\/?[A-Za-z_][\w:.-]*(?:\s[^<>]*?)?\s*\/?>/g)) {
        if (/^<\//.test(tag[0])) depth--
        else if (!/\/>$/.test(tag[0]) && !/^<\?/.test(tag[0])) depth++
        if (depth > 128 || depth < 0) throw new Error(`DOCX XML structure is too deeply nested or malformed: ${name}`)
      }
      if (depth !== 0) throw new Error(`DOCX XML structure is malformed: ${name}`)
    }
    const extracted = await mammoth.extractRawText({ buffer: captured })
    const text = extracted.value.replace(/\r/g, '').trim()
    const characterCount = [...text].length
    if (characterCount > limits.codePoints) throw new Error('DOCX text exceeds the 500,000 character limit.')
    if ([...text].filter(character => !/\s/u.test(character)).length < 100) throw new Error('This DOCX has no usable text.')
    const links = []
    const relText = xml.get('word/_rels/document.xml.rels') || ''
    const relationMap = new Map([...relText.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].map(match => {
      const attrs = Object.fromEntries([...match[1].matchAll(/([\w:]+)\s*=\s*['"]([^'"]*)['"]/g)].map(a => [a[1], decode(a[2])]))
      return [attrs.Id, attrs.Target]
    }))
    const body = xml.get('word/document.xml')
    for (const paragraph of body.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
      const label = [...paragraph[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(item => decode(item[1])).join('')
      for (const link of paragraph[0].matchAll(/<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>/g)) {
        const id = link[1].match(/\br:id\s*=\s*['"]([^'"]+)['"]/i)?.[1]
        const target = id ? relationMap.get(id) : undefined
        const linkLabel = [...link[2].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(item => decode(item[1])).join('')
        if (target && /^https?:\/\//i.test(target) && linkLabel) links.push({ label: linkLabel, url: target })
      }
    }
    parentPort.postMessage({ ok: true, value: { sha256: createHash('sha256').update(captured).digest('hex'), pages: [{ page: 1, text, links }], characterCount } })
  } catch (error) {
    const message = error instanceof Error && /^(Choose|The selected|DOCX |Macro-enabled|External DOCX|This DOCX)/.test(error.message) ? error.message : 'This DOCX could not be read. It may be malformed, encrypted, or unsupported.'
    parentPort.postMessage({ ok: false, message })
  }
})
