import { expect, test } from 'vitest'
import JSZip from 'jszip'
import { extractProfileDocx, profileDocxLimits } from '../src/main/profile-docx-intake'
import { mapProfilePdfPages } from '../src/shared/profile-pdf-import'
import { mapProfileDocxPages } from '../src/shared/profile-docx-import'

async function makeDocx(document = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>NAME: Ada Example</w:t></w:r></w:p><w:p><w:r><w:t>EMAIL: ada@example.test</w:t></w:r></w:p><w:p><w:r><w:t>EXPERIENCE: Example Labs | Engineer | 2020-01 – 2022-03</w:t></w:r></w:p><w:p><w:r><w:t>FACT: Built data tools for customers</w:t></w:r></w:p><w:p><w:r><w:t>SKILLS: Python, SQL</w:t></w:r></w:p><w:p><w:r><w:t>SUMMARY: Practical engineer with a record of delivering reliable software</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>SPOKEN LANGUAGES: Arabic, English</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>', relationships = '') {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', document)
  zip.file('word/_rels/document.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

function zipDirectory(bytes: Buffer) {
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) if (bytes.readUInt32LE(offset) === 0x06054b50) return { offset, count: bytes.readUInt16LE(offset + 10), start: bytes.readUInt32LE(offset + 16) }
  throw new Error('fixture ZIP has no directory')
}
function replaceZipName(bytes: Buffer, oldName: string, newName: string) {
  const directory = zipDirectory(bytes), oldBytes = Buffer.from(oldName), newBytes = Buffer.from(newName)
  if (oldBytes.length !== newBytes.length) throw new Error('fixture names must have equal lengths')
  let cursor = directory.start
  for (let i = 0; i < directory.count; i++) {
    const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32)
    const localOffset = bytes.readUInt32LE(cursor + 42), nameAt = cursor + 46
    if (bytes.subarray(nameAt, nameAt + nameLength).equals(oldBytes)) {
      const localNameLength = bytes.readUInt16LE(localOffset + 26)
      bytes.set(newBytes, localOffset + 30); bytes.set(newBytes, nameAt)
      if (localNameLength !== newBytes.length) throw new Error('fixture local name mismatch')
    }
    cursor += 46 + nameLength + extraLength + commentLength
  }
}
function corruptEntryCrc(bytes: Buffer, name: string) {
  const directory = zipDirectory(bytes); let cursor = directory.start
  for (let i = 0; i < directory.count; i++) {
    const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32)
    if (bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString() === name) {
      const localOffset = bytes.readUInt32LE(cursor + 42), corrupt = bytes.readUInt32LE(cursor + 16) ^ 0x01020304
      bytes.writeUInt32LE(corrupt >>> 0, cursor + 16); bytes.writeUInt32LE(corrupt >>> 0, localOffset + 14)
      return
    }
    cursor += 46 + nameLength + extraLength + commentLength
  }
  throw new Error('fixture entry not found')
}
function declareExpandedSize(bytes: Buffer, name: string, size: number) {
  const directory = zipDirectory(bytes); let cursor = directory.start
  for (let i = 0; i < directory.count; i++) {
    const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32)
    if (bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString() === name) {
      bytes.writeUInt32LE(size, cursor + 24)
      bytes.writeUInt32LE(size, bytes.readUInt32LE(cursor + 42) + 22)
      return
    }
    cursor += 46 + nameLength + extraLength + commentLength
  }
  throw new Error('fixture entry not found')
}

test('reads real DOCX text, builds mapped source text and hashes the captured document', async () => {
  const bytes = await makeDocx()
  const source = await extractProfileDocx(bytes)
  expect(source.pages[0].text).toContain('EXPERIENCE: Example Labs | Engineer')
  expect(source.characterCount).toBeGreaterThan(100)
  expect(source.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(source.sha256).toBe((await extractProfileDocx(bytes)).sha256)
  const mapped = mapProfilePdfPages(source.pages.map(page => ({ page: page.page, text: page.text, links: [] })))
  expect(mapped.contact).toMatchObject({ fullName: 'Ada Example', email: 'ada@example.test' })
  expect(mapped.experience).toMatchObject([{ organization: 'Example Labs', title: 'Engineer', factualItems: [{ text: 'Built data tools for customers' }] }])
  expect(mapped.skills.map(skill => skill.name)).toEqual(['Python', 'SQL'])
  expect(mapped.entries.filter(entry => entry.section === 'languages').map(entry => entry.title)).toEqual(['Arabic', 'English'])
})

test('keeps contact, project and ambiguous links tied to their Word paragraph context', async () => {
  const document = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' +
    '<w:p><w:r><w:t>NAME: Ada Example</w:t></w:r></w:p><w:p><w:r><w:t>EMAIL: ada@example.test</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>CONTACT LINK: </w:t></w:r><w:hyperlink r:id="rId1"><w:r><w:t>Portfolio</w:t></w:r></w:hyperlink></w:p>' +
    '<w:p><w:r><w:t>PROJECT: Atlas | Python</w:t></w:r></w:p><w:p><w:r><w:t>Built a local forecasting tool: </w:t></w:r><w:hyperlink r:id="rId2"><w:r><w:t>Repository</w:t></w:r></w:hyperlink></w:p>' +
    '<w:p><w:r><w:t>EXPERIENCE: Northwind | Engineer</w:t></w:r></w:p><w:p><w:r><w:t>FACT: Delivered this customer program: </w:t></w:r><w:hyperlink r:id="rId3"><w:r><w:t>Release notes</w:t></w:r></w:hyperlink></w:p>' +
    '<w:p><w:r><w:t>Additional CV content sufficient to exceed the local minimum useful text threshold without inventing any claims.</w:t></w:r></w:p></w:body></w:document>'
  const rels = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://ada.example.test" TargetMode="External"/><Relationship TargetMode="External" Target="https://atlas.example.test/repository" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Id="rId2"/><Relationship Id="rId3" Target="https://northwind.example.test/release" TargetMode="External" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"/>'
  const source = await extractProfileDocx(await makeDocx(document, rels))
  const result = mapProfileDocxPages(source.pages)
  expect(result.contact?.links).toEqual([{ label: 'Portfolio', url: 'https://ada.example.test' }])
  expect(result.projects[0]?.links).toEqual([{ label: 'Repository', url: 'https://atlas.example.test/repository' }])
  expect(result.unmapped.some(item => item.text.includes('https://northwind.example.test/release') && item.text.includes('Delivered this customer program'))).toBe(true)
  expect(result.sources.find(item => item.field === 'projects.links')?.passage).toContain('Built a local forecasting tool')
})

test('rejects wrong-format, oversized and hostile XML DOCX inputs', async () => {
  await expect(extractProfileDocx(Buffer.from('not a document'))).rejects.toThrow('not a DOCX')
  await expect(extractProfileDocx(new Uint8Array(profileDocxLimits.bytes + 1))).rejects.toThrow('15 MiB')
  const hostile = await makeDocx('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>&e;</w:t></w:r></w:p></w:body></w:document>')
  await expect(extractProfileDocx(hostile)).rejects.toThrow('XML declarations and entities')
  const malformed = await makeDocx('<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Some malformed XML content with enough chars maybe not needed</w:t></w:r></w:body></w:document>')
  await expect(extractProfileDocx(malformed)).rejects.toThrow('XML structure is malformed')
})

test('rejects macro-enabled packages and archives exceeding the member ceiling', async () => {
  const macroZip = new JSZip()
  macroZip.file('[Content_Types].xml', '<Types ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>')
  macroZip.file('word/document.xml', '<w:document><w:body/></w:document>')
  macroZip.file('word/_rels/document.xml.rels', '<Relationships/>')
  await expect(extractProfileDocx(await macroZip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow('Macro-enabled')
  const many = new JSZip()
  for (let index = 0; index < 101; index++) many.file(`word/part-${index}.xml`, '<part/>')
  await expect(extractProfileDocx(await many.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow('no more than 100')
})

test('verifies entry CRC after metadata bounds and rejects unsafe duplicate paths and expansion', async () => {
  const pathZip = new JSZip(); pathZip.file('word/ok.xml', '<part/>')
  const unsafe = Buffer.from(await pathZip.generateAsync({ type: 'nodebuffer' })); replaceZipName(unsafe, 'word/ok.xml', '../evil.xml')
  await expect(extractProfileDocx(unsafe)).rejects.toThrow('unsafe or duplicate archive path')

  const duplicateZip = new JSZip(); duplicateZip.file('word/alpha.xml', '<one/>'); duplicateZip.file('word/bravo.xml', '<two/>')
  const duplicate = Buffer.from(await duplicateZip.generateAsync({ type: 'nodebuffer' })); replaceZipName(duplicate, 'word/bravo.xml', 'word/alpha.xml')
  await expect(extractProfileDocx(duplicate)).rejects.toThrow('unsafe or duplicate archive path')

  const expandedZip = new JSZip(); expandedZip.file('word/document.xml', '<w:document/>')
  const expanded = Buffer.from(await expandedZip.generateAsync({ type: 'nodebuffer' })); declareExpandedSize(expanded, 'word/document.xml', profileDocxLimits.expanded + 1)
  await expect(extractProfileDocx(expanded)).rejects.toThrow('expanded content exceeds the 50 MiB limit')

  const liedZip = new JSZip(); liedZip.file('word/payload.bin', 'compressible-content-'.repeat(150_000))
  const lied = Buffer.from(await liedZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })); declareExpandedSize(lied, 'word/payload.bin', 1)
  await expect(extractProfileDocx(lied)).rejects.toThrow('actual expanded content exceeds its declared')

  const corruptZip = Buffer.from(await makeDocx())
  corruptEntryCrc(corruptZip, 'word/document.xml')
  await expect(extractProfileDocx(corruptZip)).rejects.toThrow('CRC mismatch or corrupt content')
})

test('rejects excessive XML depth and empty documents', async () => {
  const deep = `<w:document xmlns:w="urn:w"><w:body>${'<x>'.repeat(130)}Too deep${'</x>'.repeat(130)}</w:body></w:document>`
  await expect(extractProfileDocx(await makeDocx(deep))).rejects.toThrow('too deeply nested')
  const empty = await makeDocx('<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>  </w:t></w:r></w:p></w:body></w:document>')
  await expect(extractProfileDocx(empty)).rejects.toThrow('no usable text')
})

test('rejects external embedded-resource relationships and accepts inert hyperlink targets', async () => {
  const externalImage = await makeDocx(undefined, '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.test/image" TargetMode="External"/>')
  await expect(extractProfileDocx(externalImage)).rejects.toThrow('External DOCX resources')
  const reorderedAttributes = await makeDocx(undefined, '<Relationship TargetMode="External" Target="https://example.test/image" Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>')
  await expect(extractProfileDocx(reorderedAttributes)).rejects.toThrow('External DOCX resources')
  const linked = await makeDocx('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:hyperlink r:id="rId5"><w:r><w:t>Portfolio</w:t></w:r></w:hyperlink><w:r><w:t> Ada Example with enough substantial professional content to pass the minimum selectable text threshold and remain reviewable by the person before profile application.</w:t></w:r></w:p></w:body></w:document>', '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://ada.example.test" TargetMode="External"/>')
  const extracted = await extractProfileDocx(linked)
  expect(extracted.pages[0].paragraphs.flatMap(paragraph => paragraph.links)).toEqual([{ label: 'Portfolio', url: 'https://ada.example.test' }])
})
