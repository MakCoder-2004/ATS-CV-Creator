import { expect, test } from 'vitest'
import JSZip from 'jszip'
import { extractProfileDocx, profileDocxLimits } from '../src/main/profile-docx-intake'
import { mapProfilePdfPages } from '../src/shared/profile-pdf-import'

async function makeDocx(document = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>NAME: Ada Example</w:t></w:r></w:p><w:p><w:r><w:t>EMAIL: ada@example.test</w:t></w:r></w:p><w:p><w:r><w:t>EXPERIENCE: Example Labs | Engineer | 2020-01 – 2022-03</w:t></w:r></w:p><w:p><w:r><w:t>FACT: Built data tools for customers</w:t></w:r></w:p><w:p><w:r><w:t>SKILLS: Python, SQL</w:t></w:r></w:p><w:p><w:r><w:t>SUMMARY: Practical engineer with a record of delivering reliable software</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>SPOKEN LANGUAGES: Arabic, English</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>', relationships = '') {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', document)
  zip.file('word/_rels/document.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

test('reads real DOCX text, builds mapped source text and hashes the captured document', async () => {
  const bytes = await makeDocx()
  const source = await extractProfileDocx(bytes)
  expect(source.pages[0].text).toContain('EXPERIENCE: Example Labs | Engineer')
  expect(source.characterCount).toBeGreaterThan(100)
  expect(source.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(source.sha256).toBe((await extractProfileDocx(bytes)).sha256)
  const mapped = mapProfilePdfPages(source.pages.map(page => ({ ...page, text: [page.text, ...page.links.map(link => `CONTACT LINK: ${link.label} | ${link.url}`)].join('\n'), links: [] })))
  expect(mapped.contact).toMatchObject({ fullName: 'Ada Example', email: 'ada@example.test' })
  expect(mapped.experience).toMatchObject([{ organization: 'Example Labs', title: 'Engineer', factualItems: [{ text: 'Built data tools for customers' }] }])
  expect(mapped.skills.map(skill => skill.name)).toEqual(['Python', 'SQL'])
  expect(mapped.entries.filter(entry => entry.section === 'languages').map(entry => entry.title)).toEqual(['Arabic', 'English'])
})

test('rejects wrong-format, oversized and hostile XML DOCX inputs', async () => {
  await expect(extractProfileDocx(Buffer.from('not a document'))).rejects.toThrow('not a DOCX')
  await expect(extractProfileDocx(new Uint8Array(profileDocxLimits.bytes + 1))).rejects.toThrow('15 MiB')
  const hostile = await makeDocx('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>&e;</w:t></w:r></w:p></w:body></w:document>')
  await expect(extractProfileDocx(hostile)).rejects.toThrow('XML declarations and entities')
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

test('rejects external embedded-resource relationships and accepts inert hyperlink targets', async () => {
  const externalImage = await makeDocx(undefined, '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.test/image" TargetMode="External"/>')
  await expect(extractProfileDocx(externalImage)).rejects.toThrow('External DOCX resources')
  const linked = await makeDocx('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:hyperlink r:id="rId5"><w:r><w:t>Portfolio</w:t></w:r></w:hyperlink><w:r><w:t> Ada Example with enough substantial professional content to pass the minimum selectable text threshold and remain reviewable by the person before profile application.</w:t></w:r></w:p></w:body></w:document>', '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://ada.example.test" TargetMode="External"/>')
  const extracted = await extractProfileDocx(linked)
  expect(extracted.pages[0].links).toEqual([{ label: 'Portfolio', url: 'https://ada.example.test' }])
})
