import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeEncryptedProfilePdf } from '../fixtures/encrypted-profile-pdf'
import { makeLayoutProfilePdf } from '../fixtures/layout-profile-pdf'

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

test('visible populated-profile review applies explicit contact update, duplicate skip, and new skill add', async () => {
  test.setTimeout(120000)
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-pdf-merge-')), userData = join(root, 'workspace'), sourceFile = join(root, 'cv.pdf')
  writeFileSync(sourceFile, makePdf(['NAME: Ada Lovelace', 'EMAIL: ada@example.test', 'SKILLS: TypeScript, Python', 'EXPERIENCE: Example Labs | Engineer', 'FACT: Maintained the internal API', 'FACT: Built a data pipeline', 'PROJECT: Atlas | React', 'FACT: Added offline support', 'This synthetic CV contains enough selectable source text for the local PDF intake threshold and profile review workflow.']))
  let running: ElectronApplication | undefined
  try {
    running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], timeout: 15000, env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
    running.process().stderr?.on('data', data => console.log(`Electron stderr: ${String(data)}`))
    const page = await running.firstWindow({ timeout: 15000 })
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'My profile' }).click()
    const before = await page.evaluate(async () => {
      await window.workbench.saveContact({ fullName: 'Ada Lovelace', email: 'old@example.test' })
      await window.workbench.saveSkill({ name: 'TypeScript', category: 'Technical' })
      await window.workbench.saveSkill({ name: 'SQLite', category: 'Tools' })
      await window.workbench.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Example Labs', description: 'Current role details', factualItems: [{ text: 'Maintained the internal API' }] })
      await window.workbench.saveProject({ name: 'Atlas', description: 'Current project details', factualItems: [{ text: 'Built the dashboard' }], technologies: [{ text: 'TypeScript' }], links: [{ label: 'Current repository', url: 'https://example.test/atlas' }] })
      return window.workbench.getProfile()
    })
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, sourceFile)
    await page.getByRole('button', { name: 'Upload CV' }).click()
    const review = page.getByRole('region', { name: 'Review proposed profile details' })
    await expect(review.getByRole('heading', { name: 'Review proposed profile details' })).toBeVisible({ timeout: 15000 })
    const contact = review.getByRole('group', { name: 'Contact details' })
    await expect(contact.getByText(/Current: old@example.test/)).toBeVisible()
    await contact.getByLabel('Update', { exact: true }).check()
    const typescript = review.getByRole('group', { name: 'Skill 1' })
    await expect(typescript.getByText(/Current: Technical/)).toBeVisible()
    await expect(typescript.getByLabel('Skip', { exact: true })).toBeChecked()
    await expect(review.getByRole('group', { name: 'Skill 2' }).getByLabel('Add', { exact: true })).toBeChecked()
    const role = review.getByRole('group', { name: 'Experience 1' })
    await expect(role.getByText(/Current: Example Labs.*Current role details.*Maintained the internal API/)).toBeVisible()
    await role.locator(':scope > .pdf-merge-choice').getByLabel('Update', { exact: true }).check()
    await expect(role.getByText(/Current: Maintained the internal API/)).toBeVisible()
    await expect(role.locator('.pdf-nested-proposal').nth(0).getByLabel('Skip', { exact: true })).toBeChecked()
    await expect(role.locator('.pdf-nested-proposal').nth(1).getByLabel('Add', { exact: true })).toBeChecked()
    const project = review.getByRole('group', { name: 'Project 1' })
    await expect(project.getByText(/Current: Current project details/)).toBeVisible()
    await project.locator(':scope > .pdf-merge-choice').getByLabel('Update', { exact: true }).check()
    await review.getByRole('button', { name: 'Apply accepted details' }).click()
    await expect(page.getByRole('status')).toContainText('decisions were applied')
    const after = await page.evaluate(() => window.workbench.getProfile())
    expect(after.contact).toMatchObject({ id: before.contact!.id, revision: 2, email: 'ada@example.test' })
    expect(after.skills).toContainEqual(expect.objectContaining({ id: before.skills.find(skill => skill.name === 'TypeScript')!.id, revision: 1, name: 'TypeScript' }))
    expect(after.skills).toContainEqual(expect.objectContaining({ id: before.skills.find(skill => skill.name === 'SQLite')!.id, revision: 1, name: 'SQLite' }))
    expect(after.skills.filter(skill => skill.name === 'Python')).toHaveLength(1)
    const experience = await page.evaluate(() => window.workbench.getExperience())
    expect(experience.experience).toHaveLength(1)
    expect(experience.experience[0]).toMatchObject({ id: expect.any(String), revision: 2, factualItems: [{ text: 'Maintained the internal API', revision: 1 }, { text: 'Built a data pipeline' }] })
    expect(experience.projects).toHaveLength(1)
    expect(experience.projects[0]).toMatchObject({ name: 'Atlas', revision: 2, technologies: [{ text: 'TypeScript', revision: 1 }, { text: 'React' }], links: [{ url: 'https://example.test/atlas' }], factualItems: [{ text: 'Built the dashboard' }, { text: 'Added offline support' }] })
  } finally { await running?.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
})

test('rejects a forged nested update from another role and rolls back profile and provenance atomically', async () => {
  test.setTimeout(120000)
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-wrong-parent-')), userData = join(root, 'workspace'), sourceFile = join(root, 'cv.pdf'), backupFile = join(root, 'workspace-backup.json')
  writeFileSync(sourceFile, makePdf(['NAME: Ada Lovelace', 'EMAIL: new@example.test', 'EXPERIENCE: Example Labs | Engineer', 'FACT: Improved the parser', 'FACT: Added a second parser behavior', 'This synthetic CV includes enough selectable detail to support a local source-backed profile import review.']))
  let running: ElectronApplication | undefined
  try {
    running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], timeout: 15000, env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
    const page = await running.firstWindow({ timeout: 15000 })
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15000 })
    const seeded = await page.evaluate(async () => {
      const contact = await window.workbench.saveContact({ fullName: 'Ada Lovelace', email: 'old@example.test' })
      const firstRole = await window.workbench.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Example Labs', description: 'Existing role', factualItems: [{ text: 'Maintained the parser' }] })
      const otherRole = await window.workbench.saveExperience({ kind: 'employment', title: 'Consultant', organization: 'Northwind', description: 'Separate role', factualItems: [{ text: 'Migrated reports' }] })
      if (!contact.ok || !firstRole.ok || !otherRole.ok) throw new Error('Could not seed the cross-parent test profile')
      return { contact: contact.value.contact!, firstRole: firstRole.value.experience.find(item => item.title === 'Engineer')!, otherFactId: otherRole.value.experience.find(item => item.title === 'Consultant')!.factualItems[0].id }
    })
    const beforeProfile = await page.evaluate(() => window.workbench.getProfile())
    const beforeExperience = await page.evaluate(() => window.workbench.getExperience())
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, sourceFile)
    const preview = await page.evaluate(() => window.workbench.previewProfilePdfImport())
    if (!preview.ok) throw new Error(preview.message)
    const role = preview.proposals.experience[0], fact = role.factualItems[0], contactProposal = preview.proposals.contact
    if (!contactProposal) throw new Error('The synthetic PDF contact proposal was not mapped')
    const proposals = { ...preview.proposals, decisions: { [contactProposal.proposalRef]: { action: 'update' as const, targetId: seeded.contact.id }, [role.proposalRef]: { action: 'update' as const, targetId: seeded.firstRole.id }, ...Object.fromEntries(role.factualItems.map(item => [item.proposalRef, item.proposalRef === fact.proposalRef ? { action: 'update' as const, targetId: seeded.otherFactId } : { action: 'skip' as const }])) } }
    const result = await page.evaluate(async ({ token, proposals }) => window.workbench.applyProfilePdfImport(token, proposals), { token: preview.token, proposals })
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('parent') })
    expect(await page.evaluate(() => window.workbench.getProfile())).toEqual(beforeProfile)
    expect(await page.evaluate(() => window.workbench.getExperience())).toEqual(beforeExperience)
    const repeatedPreview = await page.evaluate(() => window.workbench.previewProfilePdfImport())
    if (!repeatedPreview.ok) throw new Error(repeatedPreview.message)
    const duplicateRole = repeatedPreview.proposals.experience[0]
    const duplicateDecisions = { [repeatedPreview.proposals.contact!.proposalRef]: { action: 'update' as const, targetId: seeded.contact.id }, [duplicateRole.proposalRef]: { action: 'update' as const, targetId: seeded.firstRole.id }, ...Object.fromEntries(duplicateRole.factualItems.map(item => [item.proposalRef, { action: 'update' as const, targetId: seeded.firstRole.factualItems[0].id }])) }
    const duplicateResult = await page.evaluate(async ({ token, proposals }) => window.workbench.applyProfilePdfImport(token, proposals), { token: repeatedPreview.token, proposals: { ...repeatedPreview.proposals, decisions: duplicateDecisions } })
    expect(duplicateResult).toMatchObject({ ok: false, message: expect.stringContaining('parent') })
    expect(await page.evaluate(() => window.workbench.getProfile())).toEqual(beforeProfile)
    expect(await page.evaluate(() => window.workbench.getExperience())).toEqual(beforeExperience)
    await running.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); return true }, backupFile)
    expect(await page.evaluate(() => window.workbench.exportWorkspaceBackup())).toMatchObject({ ok: true })
    expect(JSON.parse(readFileSync(backupFile, 'utf8')).tables.profile_import_provenance.rows).toEqual([])
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
