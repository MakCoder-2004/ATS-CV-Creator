const { parentPort } = require('node:worker_threads')
const { createHash } = require('node:crypto')
const JSZip = require('jszip')
const crc32 = require('jszip/lib/crc32')

const limits = { bytes: 15 * 1024 * 1024, entries: 100, expanded: 50 * 1024 * 1024, part: 20 * 1024 * 1024, codePoints: 500_000 }
const decode = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const unsafePath = name => !name || name.startsWith('/') || /^[a-z]:/i.test(name) || name.includes('\\') || name.split('/').includes('..')
let actualExpanded = 0

function readBounded(file, entry, keepContent) {
  return new Promise((resolve, reject) => {
    const stream = file.internalStream('uint8array'), chunks = []
    let size = 0, checksum = 0, settled = false
    const fail = error => { if (settled) return; settled = true; stream.pause(); reject(error) }
    stream.on('data', chunk => {
      if (settled) return
      size += chunk.byteLength; actualExpanded += chunk.byteLength
      if (size > entry.uncompressedSize || actualExpanded > limits.expanded) return fail(new Error('DOCX actual expanded content exceeds its declared or 50 MiB limit.'))
      if (/\.(?:xml|rels)$/i.test(entry.name) && size > limits.part) return fail(new Error('A DOCX XML part exceeds the 20 MiB limit.'))
      checksum = crc32(chunk, checksum) >>> 0
      if (keepContent) chunks.push(Buffer.from(chunk))
    })
    stream.on('error', fail)
    stream.on('end', () => {
      if (settled) return
      if (size !== entry.uncompressedSize || checksum !== (file._data.crc32 >>> 0)) return fail(new Error('DOCX archive contains a CRC mismatch or corrupt content.'))
      settled = true; resolve(keepContent ? Buffer.concat(chunks, size) : undefined)
    })
    stream.resume()
  })
}

/** Inspect central-directory declarations before JSZip is allowed to inflate any entry. */
function inspectZip(buffer) {
  const min = Math.max(0, buffer.length - 65_557)
  let eocd = -1
  for (let offset = buffer.length - 22; offset >= min; offset--) if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break }
  if (eocd < 0) throw new Error('DOCX ZIP directory is missing or malformed.')
  const disk = buffer.readUInt16LE(eocd + 4), directoryDisk = buffer.readUInt16LE(eocd + 6)
  const diskCount = buffer.readUInt16LE(eocd + 8), count = buffer.readUInt16LE(eocd + 10)
  const directorySize = buffer.readUInt32LE(eocd + 12), directoryOffset = buffer.readUInt32LE(eocd + 16)
  const commentLength = buffer.readUInt16LE(eocd + 20)
  if (disk || directoryDisk || diskCount !== count || count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw new Error('Multi-disk and ZIP64 DOCX archives are not supported.')
  if (count < 1 || count > limits.entries) throw new Error('DOCX archives may contain no more than 100 files.')
  if (eocd + 22 + commentLength !== buffer.length || directoryOffset + directorySize > eocd || directoryOffset + directorySize > buffer.length) throw new Error('DOCX ZIP directory is malformed.')
  let cursor = directoryOffset, expanded = 0
  const names = new Set(), entries = []
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > directoryOffset + directorySize || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('DOCX ZIP directory is malformed.')
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20), uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28), extraLength = buffer.readUInt16LE(cursor + 30), entryCommentLength = buffer.readUInt16LE(cursor + 32)
    const externalAttributes = buffer.readUInt32LE(cursor + 38), localOffset = buffer.readUInt32LE(cursor + 42)
    const end = cursor + 46 + nameLength + extraLength + entryCommentLength
    if (end > directoryOffset + directorySize || localOffset + 30 > directoryOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('DOCX ZIP directory is malformed.')
    if ((flags & 0x0001) || (flags & 0x0040)) throw new Error('Encrypted DOCX archives are not supported.')
    if (![0, 8].includes(method)) throw new Error('This DOCX uses an unsupported ZIP compression method.')
    const rawName = buffer.subarray(cursor + 46, cursor + 46 + nameLength)
    const localFlags = buffer.readUInt16LE(localOffset + 6), localMethod = buffer.readUInt16LE(localOffset + 8)
    const localNameLength = buffer.readUInt16LE(localOffset + 26), localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const localName = buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength)
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength
    if (localFlags !== flags || localMethod !== method || !localName.equals(rawName) || dataOffset + compressedSize > directoryOffset) throw new Error('DOCX local and central ZIP entries do not match.')
    if (!(flags & 0x0008) && (buffer.readUInt32LE(localOffset + 14) !== buffer.readUInt32LE(cursor + 16) || buffer.readUInt32LE(localOffset + 18) !== compressedSize || buffer.readUInt32LE(localOffset + 22) !== uncompressedSize)) throw new Error('DOCX local and central ZIP entries do not match.')
    let name
    try { name = new TextDecoder(flags & 0x0800 ? 'utf-8' : 'windows-1252', { fatal: true }).decode(rawName) } catch { throw new Error('DOCX archive contains an invalid file name.') }
    if (unsafePath(name) || names.has(name)) throw new Error('The DOCX contains an unsafe or duplicate archive path.')
    names.add(name)
    const mode = externalAttributes >>> 16
    if ((mode & 0xf000) === 0xa000) throw new Error('DOCX symbolic links are not supported.')
    expanded += uncompressedSize
    if (expanded > limits.expanded) throw new Error('DOCX expanded content exceeds the 50 MiB limit.')
    if (/\.(?:xml|rels)$/i.test(name) && uncompressedSize > limits.part) throw new Error('A DOCX XML part exceeds the 20 MiB limit.')
    entries.push({ name, uncompressedSize, compressedSize, mode })
    cursor = end
  }
  if (cursor !== directoryOffset + directorySize) throw new Error('DOCX ZIP directory is malformed.')
  return entries
}

parentPort.postMessage({ ready: true })
parentPort.on('message', async bytes => {
  try {
    const captured = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (!captured.length || captured.length > limits.bytes) throw new Error('Choose a non-empty DOCX smaller than 15 MiB.')
    if (captured.subarray(0, 4).toString('hex') !== '504b0304') throw new Error('The selected file is not a DOCX document.')
    const declaredEntries = inspectZip(captured)
    // Loading with CRC disabled parses metadata only. Each member is inflated and CRC-checked
    // below, only after path/count/expanded-size bounds have been accepted.
    const zip = await JSZip.loadAsync(captured, { checkCRC32: false, createFolders: false })
    const files = Object.values(zip.files).filter(file => !file.dir)
    if (files.length !== declaredEntries.filter(entry => !entry.name.endsWith('/')).length) throw new Error('DOCX ZIP directory contents do not match.')
    const xml = new Map()
    for (const entry of declaredEntries) {
      const file = zip.files[entry.name]
      if (!file) throw new Error('DOCX ZIP directory contents do not match.')
      const keepContent = /\.(?:xml|rels)$/i.test(entry.name)
      const content = await readBounded(file, entry, keepContent)
      if (keepContent) {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(content)
        if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(text)) throw new Error('DOCX XML declarations and entities are not supported.')
        if (/<(?:[\w.-]+:)?Relationship\b[^>]*\bTargetMode\s*=\s*['"]External['"][^>]*>/i.test(text) && /relationships\/(?:image|oleObject|package|attachedTemplate)/i.test(text)) throw new Error('External DOCX resources are not supported.')
        if ((text.match(/</g) || []).length > 250_000) throw new Error('DOCX XML contains too many elements.')
        xml.set(entry.name, text)
      }
    }
    if (!xml.has('word/document.xml')) throw new Error('The DOCX document body is missing.')
    if (/macroEnabled|vbaProject/i.test(xml.get('[Content_Types].xml') || '') || declaredEntries.some(entry => /(?:\.docm|vbaProject\.bin)$/i.test(entry.name))) throw new Error('Macro-enabled documents are not supported.')
    for (const [name, text] of xml) {
      const stack = []
      const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([A-Za-z_][\w:.-]*)\b[^>]*>/g
      let consumed = 0
      for (const tag of text.matchAll(tokens)) {
        if (text.slice(consumed, tag.index).includes('<')) throw new Error(`DOCX XML structure is malformed: ${name}`)
        consumed = tag.index + tag[0].length
        if (!tag[1]) continue
        if (/^<\//.test(tag[0])) {
          if (stack.pop() !== tag[1]) throw new Error(`DOCX XML structure is malformed: ${name}`)
        } else if (!/\/\s*>$/.test(tag[0])) {
          stack.push(tag[1])
          if (stack.length > 128) throw new Error(`DOCX XML structure is too deeply nested: ${name}`)
        }
      }
      if (text.slice(consumed).includes('<') || stack.length) throw new Error(`DOCX XML structure is malformed: ${name}`)
    }
    const body = xml.get('word/document.xml')
    const relationXml = xml.get('word/_rels/document.xml.rels') || ''
    const relationMap = new Map([...relationXml.matchAll(/<(?:[\w.-]+:)?Relationship\b([^>]*)\/?\s*>/g)].map(match => {
      const attrs = Object.fromEntries([...match[1].matchAll(/([\w:]+)\s*=\s*['"]([^'"]*)['"]/g)].map(a => [a[1], decode(a[2])]))
      return [attrs.Id, attrs.Target]
    }))
    const paragraphs = []
    for (const paragraph of body.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
      const xmlParagraph = paragraph[0]
      const paragraphText = [...xmlParagraph.replace(/<w:tab\b[^>]*\/?\s*>/g, '\t').replace(/<w:br\b[^>]*\/?\s*>/g, '\n').matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(item => decode(item[1])).join('')
      const links = []
      for (const link of xmlParagraph.matchAll(/<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>/g)) {
        const id = link[1].match(/\br:id\s*=\s*['"]([^'"]+)['"]/i)?.[1]
        const target = id ? relationMap.get(id) : undefined
        const label = [...link[2].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(item => decode(item[1])).join('')
        if (target && /^https?:\/\//i.test(target) && label) links.push({ label, url: target })
      }
      if (paragraphText || links.length) paragraphs.push({ text: paragraphText, links })
    }
    const text = paragraphs.map(paragraph => paragraph.text).join('\n').replace(/\r/g, '').trim()
    const characterCount = [...text].length
    if (characterCount > limits.codePoints) throw new Error('DOCX text exceeds the 500,000 character limit.')
    if ([...text].filter(character => !/\s/u.test(character)).length < 100) throw new Error('This DOCX has no usable text.')
    parentPort.postMessage({ ok: true, value: { sha256: createHash('sha256').update(captured).digest('hex'), pages: [{ page: 1, text, links: [], paragraphs }], characterCount } })
  } catch (error) {
    const message = error instanceof Error && /^(Choose|The selected|DOCX |Macro-enabled|External DOCX|This DOCX|Encrypted DOCX|Multi-disk|The DOCX contains|DOCX archives|A DOCX XML|This DOCX uses)/.test(error.message) ? error.message : 'This DOCX could not be read. It may be malformed, encrypted, or unsupported.'
    parentPort.postMessage({ ok: false, message })
  }
})
