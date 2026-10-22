import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { makeEncryptedProfilePdf } from '../fixtures/encrypted-profile-pdf'
import { makeLayoutProfilePdf } from '../fixtures/layout-profile-pdf'

async function makeDocx() {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>NAME: Ada Example</w:t></w:r></w:p><w:p><w:r><w:t>EMAIL: ada@example.test</w:t></w:r></w:p><w:p><w:r><w:t>CONTACT LINK: </w:t></w:r><w:hyperlink r:id="rId2"><w:r><w:t>Portfolio</w:t></w:r></w:hyperlink></w:p><w:p><w:r><w:t>SKILLS: Python, SQL</w:t></w:r></w:p><w:p><w:r><w:t>EXPERIENCE: Example Labs | Engineer | 2020-01 – 2022-03</w:t></w:r></w:p><w:p><w:r><w:t>FACT: Built accessible software for customers across multiple teams</w:t></w:r></w:p><w:p><w:r><w:t>SUMMARY: Reliable engineer with substantial experience building useful software products</w:t></w:r></w:p><w:p><w:r><w:t>PROJECT: Atlas | Python</w:t></w:r></w:p><w:p><w:r><w:t>Project context with repository link: </w:t></w:r><w:hyperlink r:id="rId3"><w:r><w:t>Repository</w:t></w:r></w:hyperlink></w:p></w:body></w:document>')
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://ada.example.test" TargetMode="External"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://atlas.example.test" TargetMode="External"/></Relationships>')
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

function makePdf(lines: string[]) {
  const objects: string[] = []
  const add = (value: string) => { objects.push(value); return objects.length }
  add(''); const pages = add(''); const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const commands = `BT /F1 10 Tf\n${lines.map((line, index) => `1 0 0 1 36 ${760 - index * 18} Tm (${line.replace(/[()\\]/g, '\\$&')}) Tj`).join('\n')}\nET`
  const content = add(`<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`)
  const page = add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`)
  objects[0] = `<< /Type /Catalog /Pages ${pages} 0 R >>`; objects[pages - 1] = `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`
  let pdf = Buffer.from('%PDF-1.4\n'), offsets = [0]
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf = Buffer.concat([pdf, Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`)]) })
  const xref = pdf.length; let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`; offsets.slice(1).forEach(offset => { table += `${String(offset).padStart(10, '0')} 00000 n \n` })
  return Buffer.concat([pdf, Buffer.from(`${table}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)])
}

test('imports DOCX proposals through visible review and applies them to the existing profile contract', async () => {
  test.setTimeout(60000)
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-docx-import-')), userData = join(root, 'workspace'), sourceFile = join(root, 'synthetic-cv.docx'), backupFile = join(root, 'accepted-docx-backup.json')
  writeFileSync(sourceFile, await makeDocx())
  const original = readFileSync(sourceFile)
  let running: ElectronApplication | undefined
  try {
    running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
    const page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'My profile' }).click()
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, sourceFile)
    await page.getByRole('button', { name: 'Upload Word CV' }).click()
    const review = page.getByRole('region', { name: 'Review proposed profile details' })
    await expect(review).toBeVisible({ timeout: 15000 })
    await expect(review.getByLabel('Full name')).toHaveValue('Ada Example')
    await expect(review.getByLabel('Skill name').first()).toHaveValue('Python')
    await expect(review.getByText('Built accessible software for customers across multiple teams').first()).toBeVisible()
    await review.getByLabel('Source factual item 1').fill('Corrected wording after checking the original CV')
    await review.getByRole('button', { name: 'Apply accepted details' }).click()
    await expect(page.getByRole('status')).toContainText('added to your profile')
    expect(await page.evaluate(() => window.workbench.getProfile())).toMatchObject({ contact: { fullName: 'Ada Example', links: [{ label: 'Portfolio', url: 'https://ada.example.test' }] }, skills: [{ name: 'Python' }, { name: 'SQL' }] })
    expect(await page.evaluate(() => window.workbench.getExperience())).toMatchObject({ experience: [{ title: 'Engineer', organization: 'Example Labs', factualItems: [{ text: 'Corrected wording after checking the original CV' }] }], projects: [{ name: 'Atlas', links: [{ label: 'Repository', url: 'https://atlas.example.test' }] }] })
    expect(readFileSync(sourceFile)).toEqual(original)
    expect((await page.evaluate(() => window.workbench.getAnalysisUsage())).attempts).toBe(0)
    await running.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); return true }, backupFile)
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Back up workspace' }).click()
    await expect(page.getByRole('region', { name: 'Workspace backup' }).getByRole('status')).toContainText('Workspace backup saved')
    const provenance = JSON.parse(readFileSync(backupFile, 'utf8')).tables.profile_import_provenance.rows
    expect(provenance).toEqual(expect.arrayContaining([expect.objectContaining({ source_hash: expect.stringMatching(/^[a-f0-9]{64}$/), passage: expect.stringContaining('EXPERIENCE: Example Labs | Engineer') })]))
    expect(provenance.some((row: { field: string; passage: string }) => row.field === 'experience.factualItem' && row.passage.includes('Built accessible software for customers'))).toBe(false)
    expect(provenance.some((row: { field: string; passage: string }) => row.field === 'experience.role' && row.passage.includes('Example Labs'))).toBe(true)
    expect(provenance.some((row: { field: string; passage: string }) => row.field === 'projects.links' && row.passage.includes('Project context with repository link') && row.passage.includes('https://atlas.example.test'))).toBe(true)
    expect(provenance.some((row: { field: string; passage: string }) => row.field === 'contact.links' && row.passage.includes('CONTACT LINK:') && row.passage.includes('https://ada.example.test'))).toBe(true)
    await running.close(); running = undefined
    running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
    const reopened = await running.firstWindow()
    await expect(reopened.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15000 })
    await reopened.getByRole('button', { name: 'My profile' }).click()
    expect(await reopened.evaluate(() => window.workbench.getProfile())).toMatchObject({ contact: { fullName: 'Ada Example', links: [{ label: 'Portfolio', url: 'https://ada.example.test' }] }, skills: [{ name: 'Python' }, { name: 'SQL' }] })
    expect(await reopened.evaluate(() => window.workbench.getExperience())).toMatchObject({ experience: [{ title: 'Engineer', organization: 'Example Labs', factualItems: [{ text: 'Corrected wording after checking the original CV' }] }], projects: [{ name: 'Atlas', links: [{ label: 'Repository', url: 'https://atlas.example.test' }] }] })
    await running.close(); running = undefined
  } finally { await running?.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
})

test('imports PDF proposals through review, atomically applies supported profile sections, then backs up/restores and reopens SQLite', async () => {
  test.setTimeout(120000)
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-pdf-import-'))
  const userData = join(root, 'workspace'), sourceFile = join(root, 'synthetic-cv.pdf'), backupFile = join(root, 'accepted-profile-backup.json'), profileJson = join(root, 'accepted-profile.json')
  const lines = ['NAME: Ada Example', 'EMAIL: ada@example.test', 'HEADLINE: Software engineer', 'CONTACT LINK: Portfolio | https://ada.example.test', 'SKILLS: Python, SQL', 'EXPERIENCE: Example Labs | Engineer', 'FACT: Built a data pipeline', 'EXPERIENCE: Northwind | Consultant', 'FACT: Led a migration', 'EDUCATION: BSc Computer Science | Example University | 2020-09-14 to 2024-06-20 | GPA 3.7', 'CERTIFICATE: Safety Fundamentals | Example Institute | 2022-05', 'SUMMARY: Curious engineer', 'SPOKEN LANGUAGES: Arabic, English', 'PROJECT: Atlas | Flask, React', 'PROJECT LINK: Repository | https://example.test/atlas', 'FACT: Built a recommendation service', 'PROJECT: Beacon | Go', 'PROJECT LINK: Service | https://example.test/beacon', 'FACT: Shipped a monitoring agent', 'UNKNOWN: Community mentor', 'Additional source passage retained for review.']
  writeFileSync(sourceFile, makePdf(lines))
  const originalPdfBytes = readFileSync(sourceFile)
  let running: ElectronApplication | undefined
  const launch = async () => { running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } }); return running }
  try {
    const app = await launch(), page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'My profile' }).click()
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); return true })
    await page.getByRole('button', { name: 'Upload CV' }).click()
    await expect(page.getByRole('heading', { name: 'Review proposed profile details' })).toHaveCount(0)
    await app.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, sourceFile)
    await page.getByRole('button', { name: 'Upload CV' }).click()
    await expect(page.getByRole('heading', { name: 'Review proposed profile details' })).toBeVisible({ timeout: 15000 })
    const review = page.getByRole('region', { name: 'Review proposed profile details' })
    expect(await page.evaluate(() => { const nav = document.querySelector('[aria-label="Profile sections"]')!; const review = document.querySelector('#pdf-import-title')!; return Boolean(nav.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING) })).toBe(true)
    await expect(review.getByText(/Source hash/)).toHaveCount(0)
    await expect(review.getByLabel('Full name')).toHaveValue('Ada Example')
    await expect(review.getByLabel('Skill name').first()).toHaveValue('Python')
    await review.getByRole('group', { name: 'Skill 2' }).getByLabel('Include this proposal').uncheck()
    await expect(review.getByText('Built a data pipeline', { exact: true })).toBeVisible()
    await expect(review.getByText(/UNKNOWN: Community mentor/)).toBeVisible()
    await expect(review.getByText(/Date precision needs review/)).toBeVisible()
    const educationReview = review.getByRole('group', { name: 'Education 1' })
    await expect(educationReview.getByLabel('Include this proposal')).not.toBeChecked()
    await educationReview.getByLabel('Start date (year or year-month)').fill('2020-09')
    await educationReview.getByLabel('End date (year or year-month)').fill('2024-06')
    await educationReview.getByLabel('Include this proposal').check()
    const certificateReview = review.getByRole('group', { name: 'Certificates 2' })
    await expect(certificateReview.getByLabel('Include this proposal')).not.toBeChecked()
    await certificateReview.getByLabel('Year').fill('2022')
    await certificateReview.getByLabel('Include this proposal').check()
    await page.setViewportSize({ width: 375, height: 800 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.getByRole('button', { name: 'Use dark mode' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    await page.screenshot({ path: join(process.cwd(), 'test-results', 'profile-pdf-review-narrow-dark.png'), fullPage: true })
    await page.getByRole('button', { name: 'Use light mode' }).click()
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.screenshot({ path: join(process.cwd(), 'test-results', 'profile-pdf-review.png'), fullPage: true })
    await review.getByLabel('Full name').fill('Ada Byron Lovelace')
    await review.getByRole('button', { name: 'Apply accepted details' }).click()
    await expect(page.getByRole('status')).toContainText('added to your profile')
    expect((await page.evaluate(() => window.workbench.getAnalysisUsage())).attempts).toBe(0)
    expect(await page.evaluate(() => window.workbench.getProfile())).toMatchObject({ contact: { fullName: 'Ada Byron Lovelace', revision: 1 }, skills: [{ name: 'Python', revision: 1 }], education: [{ title: 'BSc Computer Science', institution: 'Example University', description: 'GPA 3.7' }], certificates: [{ title: 'Safety Fundamentals', issuer: 'Example Institute', year: 2022 }], summary: [{ description: expect.stringContaining('Curious engineer') }], languages: [{ title: 'Arabic' }, { title: 'English' }] })
    expect(await page.evaluate(() => window.workbench.getExperience())).toMatchObject({ experience: [{ title: 'Engineer', organization: 'Example Labs', factualItems: [{ text: 'Built a data pipeline' }] }, { title: 'Consultant', organization: 'Northwind', factualItems: [{ text: 'Led a migration' }] }], projects: [{ name: 'Atlas', technologies: [{ text: 'Flask' }, { text: 'React' }], factualItems: [{ text: 'Built a recommendation service' }] }, { name: 'Beacon', technologies: [{ text: 'Go' }], factualItems: [{ text: 'Shipped a monitoring agent' }] }] })
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); return true }, profileJson)
    page.once('dialog', nativeDialog => nativeDialog.accept())
    await page.getByRole('button', { name: 'Export profile JSON' }).click()
    await expect(page.getByRole('status')).toContainText('Profile JSON exported')
    expect(readFileSync(sourceFile)).toEqual(originalPdfBytes)
    const profileExchange = JSON.parse(readFileSync(profileJson, 'utf8'))
    expect(profileExchange).toMatchObject({ format: 'cv-tailor-profile', version: 1, profile: { contact: { fullName: 'Ada Byron Lovelace' }, skills: [{ name: 'Python' }], education: [{ title: 'BSc Computer Science' }], languages: [{ title: 'Arabic' }, { title: 'English' }] }, experience: { projects: [{ name: 'Atlas' }, { name: 'Beacon' }] } })
    expect(JSON.stringify(profileExchange)).not.toContain('sourceHash')
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); return true }, backupFile)
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Back up workspace' }).click()
    await expect(page.getByRole('region', { name: 'Workspace backup' }).getByRole('status')).toContainText('Workspace backup saved')
    const backup = JSON.parse(readFileSync(backupFile, 'utf8'))
    expect(backup.tables.profile_import_provenance.rows).toEqual(expect.arrayContaining([expect.objectContaining({ owner_id: expect.any(String), owner_revision: 1, source_hash: expect.stringMatching(/^[a-f0-9]{64}$/), passage: expect.stringContaining('SKILLS: Python, SQL') })]))
    expect(backup.tables.profile_import_provenance.rows.some((row: { passage: string; field: string }) => row.passage.includes('2020-09-14 to 2024-06-20') && row.field === 'entries.education.date')).toBe(true)
    expect(backup.tables.profile_import_provenance.rows.some((row: { passage: string }) => row.passage.startsWith('NAME:'))).toBe(false)
    const evidenceById = new Map<string, { text?: string; title?: string; organization?: string; links?: Array<{ url: string }> }>(backup.tables.evidence_revisions.rows.map((row: { id: string; snapshot: string }) => [row.id, JSON.parse(row.snapshot) as { text?: string; title?: string; organization?: string; links?: Array<{ url: string }> }]))
    const support = backup.tables.profile_import_provenance.rows as Array<{ owner_id: string; field: string; passage: string }>
    expect(support.filter(row => row.field === 'experience.factualItem').every(row => { const fact = evidenceById.get(row.owner_id); return fact?.text === row.passage.replace(/^FACT: /, '') })).toBe(true)
    expect(support.filter(row => row.field === 'experience.role').every(row => { const role = evidenceById.get(row.owner_id); return role && typeof role.title === 'string' && typeof role.organization === 'string' && row.passage.includes(role.title) && row.passage.includes(role.organization) })).toBe(true)
    expect(support.filter(row => row.field === 'projects.technology').every(row => { const technology = evidenceById.get(row.owner_id); return technology && typeof technology.text === 'string' && row.passage.includes(technology.text) })).toBe(true)
    expect(support.filter(row => row.field === 'projects.factualItem').every(row => { const fact = evidenceById.get(row.owner_id); return fact && typeof fact.text === 'string' && row.passage.includes(fact.text) })).toBe(true)
    expect(support.filter(row => row.field === 'projects.links').every(row => { const project = evidenceById.get(row.owner_id); return project && Array.isArray(project.links) && project.links.some((link: { url: string }) => row.passage.includes(link.url)) })).toBe(true)
    await page.evaluate(() => window.workbench.saveSkill({ name: 'Temporary change', category: 'Other' }))
    await app.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, backupFile)
    await page.getByRole('button', { name: 'Restore workspace' }).click()
    await expect(page.getByRole('dialog', { name: 'Replace workspace from backup?' })).toBeVisible()
    await page.getByRole('button', { name: 'Confirm workspace replacement' }).click()
    await expect(page.getByRole('region', { name: 'Workspace backup' }).getByRole('status')).toContainText('restored')
    const safetyDirectory = join(userData, 'workspace-safety-backups')
    const safetyFile = join(safetyDirectory, readdirSync(safetyDirectory)[0])
    expect(JSON.parse(readFileSync(safetyFile, 'utf8')).tables.profile_import_provenance.rows.length).toBeGreaterThan(0)
    await app.close(); running = undefined
    const reopened = await launch(), reopenedPage = await reopened.firstWindow()
    await expect(reopenedPage.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15000 })
    await reopenedPage.getByRole('button', { name: 'My profile' }).click()
    expect(await reopenedPage.evaluate(() => window.workbench.getProfile())).toMatchObject({ contact: { fullName: 'Ada Byron Lovelace' }, skills: [{ name: 'Python' }], education: [{ title: 'BSc Computer Science' }], summary: [{ description: expect.stringContaining('Curious engineer') }], languages: [{ title: 'Arabic' }, { title: 'English' }] })
    await reopened.close(); running = undefined
  } finally { await running?.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
})

test('profile changes during local review invalidate apply instead of overwriting facts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-pdf-stale-')), userData = join(root, 'workspace'), sourceFile = join(root, 'cv.pdf')
  writeFileSync(sourceFile, makePdf(['NAME: Ada Example', 'SKILLS: Python', 'This synthetic paragraph contains enough selectable characters to exceed the local text threshold safely.', 'Additional readable career source wording keeps this sample above one hundred useful characters.']))
  let running: ElectronApplication | undefined
  try {
    running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
    const page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15000 })
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, sourceFile)
    const preview = await page.evaluate(() => window.workbench.previewProfilePdfImport())
    if (!preview.ok) throw new Error(preview.message)
    await page.evaluate(() => window.workbench.saveSkill({ name: 'Newer fact', category: 'Technical' }))
    const result = await page.evaluate(async ({ token, proposals }) => window.workbench.applyProfilePdfImport(token, proposals), { token: preview.token, proposals: preview.proposals })
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('profile changed') })
    expect(await page.evaluate(() => window.workbench.getProfile())).toMatchObject({ contact: null, skills: [{ name: 'Newer fact' }] })
    await running.close(); running = undefined
  } finally { await running?.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
})

test('rejects malformed and scanned-like PDFs locally without sending requests or changing profile', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-pdf-invalid-')), userData = join(root, 'workspace')
  const malformed = join(root, 'malformed.pdf'), scanned = join(root, 'scanned.pdf'), encrypted = join(root, 'encrypted.pdf'), oversized = join(root, 'oversized.pdf')
  writeFileSync(malformed, '%PDF-1.4\\nnot a valid PDF object graph')
  writeFileSync(scanned, makePdf(['']))
  writeFileSync(encrypted, makeEncryptedProfilePdf())
  writeFileSync(oversized, Buffer.alloc(15 * 1024 * 1024 + 1))
  let running: ElectronApplication | undefined, selected = malformed
  try {
    running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
    const page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15000 })
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, selected)
    await page.getByRole('button', { name: 'My profile' }).click()
    await page.getByRole('button', { name: 'Upload CV' }).click()
    await expect(page.getByRole('alert')).toContainText('could not be read')
    selected = scanned
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, selected)
    await page.getByRole('button', { name: 'Upload CV' }).click()
    await expect(page.getByRole('alert')).toContainText('no usable selectable text')
    selected = encrypted
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, selected)
    await page.getByRole('button', { name: 'Upload CV' }).click()
    await expect(page.getByRole('alert')).toContainText('Encrypted PDFs are not supported')
    selected = oversized
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, selected)
    await page.getByRole('button', { name: 'Upload CV' }).click()
    await expect(page.getByRole('alert')).toContainText('15 MiB')
    expect(await page.evaluate(() => window.workbench.getProfile())).toMatchObject({ contact: null, skills: [] })
    expect((await page.evaluate(() => window.workbench.getAnalysisUsage())).attempts).toBe(0)
    await running.close(); running = undefined
  } finally { await running?.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
})

test('shows ambiguous two-column order and inert hyperlinks as review-only source context', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-pdf-layout-')), userData = join(root, 'workspace'), sourceFile = join(root, 'layout.pdf')
  writeFileSync(sourceFile, makeLayoutProfilePdf())
  const original = readFileSync(sourceFile)
  let running: ElectronApplication | undefined
  try {
    running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
    const page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15000 })
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, sourceFile)
    await page.getByRole('button', { name: 'My profile' }).click()
    await page.getByRole('button', { name: 'Upload CV' }).click()
    await expect(page.getByRole('heading', { name: 'Review proposed profile details' })).toBeVisible({ timeout: 15000 })
    const review = page.getByRole('region', { name: 'Review proposed profile details' })
    await expect(review.getByText(/multiple text columns.*reading order may be ambiguous/i)).toBeVisible()
    await expect(review.getByText(/Unassigned PDF hyperlink: Repository — https:\/\/example\.test\/repository/)).toBeVisible()
    await expect(review.getByRole('group', { name: 'Experience 1' }).getByLabel(/Source factual item/)).toHaveCount(0)
    await expect(review.getByRole('group', { name: 'Experience 2' }).getByLabel(/Source factual item/)).toHaveCount(0)
    page.once('dialog', nativeDialog => nativeDialog.accept())
    await review.getByRole('button', { name: 'Discard review' }).click()
    await expect(review).toHaveCount(0)
    expect(readFileSync(sourceFile)).toEqual(original)
    expect((await page.evaluate(() => window.workbench.getAnalysisUsage())).attempts).toBe(0)
    expect(await page.evaluate(() => window.workbench.getProfile())).toMatchObject({ contact: null, skills: [] })
    await running.close(); running = undefined
  } finally { await running?.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
})

test('rolls back a conflicting proposal batch without partially writing contact or profile facts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-pdf-rollback-')), userData = join(root, 'workspace'), sourceFile = join(root, 'cv.pdf')
  writeFileSync(sourceFile, makePdf(['NAME: Ada Example', 'SKILLS: Python, SQL', 'A sufficiently long source paragraph keeps this synthetic document above the text minimum.']))
  let running: ElectronApplication | undefined
  try {
    running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
    const page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15000 })
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, sourceFile)
    const preview = await page.evaluate(() => window.workbench.previewProfilePdfImport())
    if (!preview.ok) throw new Error(preview.message)
    const duplicate = structuredClone(preview.proposals)
    duplicate.skills[1].name = duplicate.skills[0].name
    const result = await page.evaluate(async ({ token, proposals }) => window.workbench.applyProfilePdfImport(token, proposals), { token: preview.token, proposals: duplicate })
    expect(result.ok).toBe(false)
    expect(await page.evaluate(() => window.workbench.getProfile())).toMatchObject({ contact: null, skills: [], education: [], certificates: [], summary: [], languages: [], extras: [] })
    expect(await page.evaluate(() => window.workbench.getExperience())).toEqual({ experience: [], projects: [] })
    await running.close(); running = undefined
  } finally { await running?.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
})
