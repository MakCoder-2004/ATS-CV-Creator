import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell } from 'electron'
import type { ZodError } from 'zod'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { renderDocumentHtml } from '../shared/document'
import { containsPdfTextInOrder, pdfFilename, writePdfAtomically } from '../shared/export'
import { z } from 'zod'
import { createWorkbench } from './workbench'
import type { AnalysisTransport } from './posting-analysis'
import { appearanceSchema } from '../shared/appearance'
import { openRouterKeyInputSchema, openRouterModelSchema } from '../shared/openrouter-settings'
import { contactSaveInputSchema, evidenceRevisionSchema, profileEntrySaveSchema, profileMutationResultSchema, profileSnapshotSchema, skillSaveInputSchema, uuidSchema } from '../shared/profile'
import { experienceSaveInputSchema, experienceSnapshotSchema, experienceMutationResultSchema, projectSaveInputSchema } from '../shared/experience'
import { jobRecordSchema, jobSaveInputSchema, jobSaveResultSchema } from '../shared/jobs'
import { registerProfileExchangeIpc } from './profile-exchange-ipc'
import { outboundConsentActionSchema, outboundConsentPreviewSchema } from '../shared/outbound-consent-contract'
import { analysisBudgetsSchema, analysisIdSchema, analysisResultSchema, analysisStartInputSchema, analysisUsageSchema } from '../shared/posting-analysis'
import { addDraftItemInputSchema, draftCorrectionInputSchema, draftGenerationSchema, draftRevisionSchema } from '../shared/draft'
import { factualCheckReportSchema } from '../shared/factual-report'

let window: BrowserWindow | undefined
let workspace: ReturnType<typeof createWorkbench> | undefined

function invalidProfileInput(error: ZodError, kind: string) {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) fieldErrors[issue.path.length ? issue.path.join('.') : '_'] = issue.message
  return profileMutationResultSchema.parse({ ok: false, error: { code: 'VALIDATION_ERROR', message: `Check the highlighted ${kind} fields.`, fieldErrors } })
}

function isTrusted(event: Electron.IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  if (!window || event.sender !== window.webContents || !frame || frame !== window.webContents.mainFrame) return false
  const url = new URL(frame.url)
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    return url.protocol === 'http:' && url.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
  }
  return url.protocol === 'file:' && fileURLToPath(url) === join(__dirname, '../renderer/index.html')
}

function trusted(event: Electron.IpcMainInvokeEvent): void {
  if (!isTrusted(event)) throw new Error('Untrusted IPC sender')
}

// The test override is disabled in packaged builds; production always uses Electron's userData.
if (!app.isPackaged && process.env.CV_TAILOR_TEST_USER_DATA_DIR) {
  mkdirSync(process.env.CV_TAILOR_TEST_USER_DATA_DIR, { recursive: true })
  app.setPath('userData', process.env.CV_TAILOR_TEST_USER_DATA_DIR)
}
app.whenReady().then(() => {
  let scriptedAttempts = 0
  const scriptedAnalysis: AnalysisTransport | undefined = !app.isPackaged && ['1', 'retry', 'generation', 'factual', 'invalid', 'faithfulness'].includes(process.env.CV_TAILOR_SCRIPTED_ANALYSIS ?? '') ? { generate: async ({ prompt }) => {
    scriptedAttempts++
    if (prompt.startsWith('Factual repair cycle')) return JSON.stringify({ corrections: [] })
    if (process.env.CV_TAILOR_SCRIPTED_ANALYSIS === 'faithfulness' && prompt.startsWith('Compare all rewritten/source pairs')) {
      const { pairs } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ results: pairs.map((pair: { itemPath: string }) => ({ itemPath: pair.itemPath, supported: false, explanation: 'Scripted smoke finding: wording needs human comparison with its source.' })) })
    }
    if (process.env.CV_TAILOR_SCRIPTED_ANALYSIS === 'retry' && scriptedAttempts === 1) throw { status: 429, retryAfter: 3 }
    if (['generation', 'factual', 'invalid', 'faithfulness'].includes(process.env.CV_TAILOR_SCRIPTED_ANALYSIS ?? '') && prompt.startsWith('Score these numbered')) {
      const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 0.9, rationale: 'Directly supports the posting.' })) })
    }
    if (process.env.CV_TAILOR_SCRIPTED_ANALYSIS === 'invalid' && prompt.startsWith('Write conservative')) return '{ malformed response'
    if (['generation', 'factual', 'invalid', 'faithfulness'].includes(process.env.CV_TAILOR_SCRIPTED_ANALYSIS ?? '') && prompt.startsWith('Write conservative')) {
      const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      const paragraphs = (category: string) => selected.filter((item: { category: string }) => item.category === category).map((item: { index: number; text: string }) => ({ text: process.env.CV_TAILOR_SCRIPTED_ANALYSIS === 'factual' && category === 'experience' ? 'Reduced delivery time by 900 percent.' : item.text, evidence: [item.index], rationale: 'Selected from authorized profile evidence.' }))
      const skills = selected.filter((item: { category: string }) => item.category === 'skills').map((item: { index: number; text: string }) => ({ name: JSON.parse(item.text).name, evidence: [item.index], rationale: 'Selected from the saved skill inventory.' }))
      return JSON.stringify({ education: paragraphs('education'), experience: paragraphs('experience'), projects: paragraphs('projects'), skills, certificates: paragraphs('certificates') })
    }
    return JSON.stringify({ required: ['TypeScript', 'Kubernetes'], preferred: ['Cloud architecture'], tools: ['TypeScript'], responsibilities: ['Build reliable services'], keywords: ['TypeScript', 'Kubernetes', 'Cloud architecture'] })
  } } : undefined
  workspace = createWorkbench(app.getPath('userData'), safeStorage, scriptedAnalysis)
  ipcMain.handle('settings:get', (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    return workspace!.api.getSettings()
  })
  ipcMain.handle('settings:appearance', (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected appearance')
    return workspace!.api.setAppearance(appearanceSchema.parse(args[0]))
  })
  ipcMain.handle('settings:openrouter-model', (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected OpenRouter model')
    return workspace!.api.setOpenRouterModel(openRouterModelSchema.parse(args[0]))
  })
  ipcMain.handle('settings:faithfulness', (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1 || typeof args[0] !== 'boolean') throw new Error('Expected faithfulness setting')
    return workspace!.api.setFaithfulnessCheck(args[0])
  })
  ipcMain.handle('settings:openrouter-key:save', (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected OpenRouter API key')
    const input = openRouterKeyInputSchema.safeParse(args[0])
    if (!input.success) throw new Error('API key input is invalid. Correct it and try again.')
    return workspace!.api.saveOpenRouterApiKey(input.data)
  })
  ipcMain.handle('settings:openrouter-key:reveal', (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    return workspace!.api.revealOpenRouterApiKey()
  })
  ipcMain.handle('settings:openrouter-key:copy', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    clipboard.writeText(await workspace!.api.revealOpenRouterApiKey())
  })
  ipcMain.handle('settings:openrouter-key:remove', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    // Clear only our copied key; never overwrite unrelated clipboard contents.
    try { if (clipboard.readText() === await workspace!.api.revealOpenRouterApiKey()) clipboard.clear() }
    catch { /* Removing a stored key must still work if decryption is unavailable. */ }
    return workspace!.api.removeOpenRouterApiKey()
  })
  registerProfileExchangeIpc(() => window!, () => workspace!.api, trusted)
  ipcMain.handle('profile:get', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    return profileSnapshotSchema.parse(await workspace!.api.getProfile())
  })
  ipcMain.handle('profile:contact:save', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected contact')
    const input = contactSaveInputSchema.safeParse(args[0])
    if (!input.success) return invalidProfileInput(input.error, 'contact')
    return profileMutationResultSchema.parse(await workspace!.api.saveContact(input.data))
  })
  ipcMain.handle('profile:contact:delete', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected contact ID')
    const id = uuidSchema.safeParse(args[0])
    if (!id.success) return invalidProfileInput(id.error, 'contact')
    return profileMutationResultSchema.parse(await workspace!.api.deleteContact(id.data))
  })
  ipcMain.handle('profile:skill:save', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected skill')
    const input = skillSaveInputSchema.safeParse(args[0])
    if (!input.success) return invalidProfileInput(input.error, 'skill')
    return profileMutationResultSchema.parse(await workspace!.api.saveSkill(input.data))
  })
  ipcMain.handle('profile:skill:delete', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected skill ID')
    const id = uuidSchema.safeParse(args[0])
    if (!id.success) return invalidProfileInput(id.error, 'skill')
    return profileMutationResultSchema.parse(await workspace!.api.deleteSkill(id.data))
  })
  ipcMain.handle('profile:entry:save', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected profile record')
    const input = profileEntrySaveSchema.safeParse(args[0])
    if (!input.success) return invalidProfileInput(input.error, 'profile')
    return profileMutationResultSchema.parse(await workspace!.api.saveProfileEntry(input.data))
  })
  ipcMain.handle('profile:entry:delete', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected profile record ID')
    const id = uuidSchema.safeParse(args[0])
    if (!id.success) return invalidProfileInput(id.error, 'profile')
    return profileMutationResultSchema.parse(await workspace!.api.deleteProfileEntry(id.data))
  })
  ipcMain.handle('profile:history', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected evidence ID')
    return evidenceRevisionSchema.array().parse(await workspace!.api.getEvidenceHistory(uuidSchema.parse(args[0])))
  })
  ipcMain.handle('profile:experience:get', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length) throw new Error('Unexpected arguments')
    return experienceSnapshotSchema.parse(await workspace!.api.getExperience())
  })
  const registerExperienceMutation = (channel: string, schema: typeof experienceSaveInputSchema | typeof projectSaveInputSchema, command: 'saveExperience' | 'saveProject') => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      trusted(event); if (args.length !== 1) throw new Error('Expected profile record')
      const parsed = schema.safeParse(args[0])
      if (!parsed.success) return experienceMutationResultSchema.parse({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Check the highlighted profile fields.', fieldErrors: Object.fromEntries(parsed.error.issues.map(issue => [issue.path.join('.') || '_', issue.message])) } })
      return experienceMutationResultSchema.parse(await workspace!.api[command](parsed.data as never))
    })
  }
  registerExperienceMutation('profile:experience:save', experienceSaveInputSchema, 'saveExperience')
  registerExperienceMutation('profile:project:save', projectSaveInputSchema, 'saveProject')
  for (const [channel, command] of [['profile:experience:delete', 'deleteExperience'], ['profile:project:delete', 'deleteProject']] as const) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      trusted(event); if (args.length !== 1) throw new Error('Expected profile record ID')
      const id = uuidSchema.safeParse(args[0])
      if (!id.success) return experienceMutationResultSchema.parse({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Profile record ID must be a UUID.', fieldErrors: { id: 'Invalid ID' } } })
      return experienceMutationResultSchema.parse(await workspace!.api[command](id.data))
    })
  }
  ipcMain.handle('jobs:save', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected job')
    const input = jobSaveInputSchema.safeParse(args[0])
    if (!input.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of input.error.issues) fieldErrors[issue.path.length ? issue.path.join('.') : '_'] = issue.message
      return jobSaveResultSchema.parse({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Enter a title, company, and job description.', fieldErrors } })
    }
    return jobSaveResultSchema.parse(await workspace!.api.saveJob(input.data))
  })
  ipcMain.handle('jobs:list', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    return jobRecordSchema.array().parse(await workspace!.api.listJobs())
  })
  ipcMain.handle('consent:outbound:preview', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 1) throw new Error('Expected saved job ID')
    return outboundConsentPreviewSchema.parse(await workspace!.api.prepareOutboundConsent(uuidSchema.parse(args[0])))
  })
  ipcMain.handle('consent:outbound:accept', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 3 || typeof args[1] !== 'boolean' || typeof args[2] !== 'boolean') throw new Error('Expected preview token and consent decisions')
    return outboundConsentActionSchema.parse(await workspace!.api.acceptOutboundConsent(uuidSchema.parse(args[0]), args[1], args[2]))
  })
  ipcMain.handle('consent:outbound:cancel', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 1) throw new Error('Expected preview token')
    return outboundConsentActionSchema.parse(await workspace!.api.cancelOutboundConsent(uuidSchema.parse(args[0])))
  })
  ipcMain.handle('analysis:start', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected consent token'); const input = analysisStartInputSchema.parse({ consentToken: args[0] }); return analysisResultSchema.parse(await workspace!.api.startAnalysis(input.consentToken)) })
  ipcMain.handle('analysis:get', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected job ID'); const result = await workspace!.api.getAnalysis(analysisIdSchema.parse(args[0])); return result === null ? null : analysisResultSchema.parse(result) })
  ipcMain.handle('draft:generate', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 2 || (args[1] !== 1 && args[1] !== 2)) throw new Error('Expected consent token and one- or two-page target'); return draftGenerationSchema.parse(await workspace!.api.generateDraft(analysisStartInputSchema.parse({ consentToken: args[0] }).consentToken, args[1])) })
  ipcMain.handle('draft:get', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected job ID'); const draft = await workspace!.api.getDraft(analysisIdSchema.parse(args[0])); return draft === null ? null : draftRevisionSchema.parse(draft) })
  ipcMain.handle('draft:check', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected job ID'); const report = await workspace!.api.checkDraft(analysisIdSchema.parse(args[0])); return report === null ? null : factualCheckReportSchema.parse(report) })
  ipcMain.handle('draft:approve', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected job ID'); return workspace!.api.approveDraft(analysisIdSchema.parse(args[0])) })
  ipcMain.handle('draft:export-guard', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected job ID'); return workspace!.api.assertDraftExportable(analysisIdSchema.parse(args[0])) })
  ipcMain.handle('draft:correct', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected correction input'); return await workspace!.api.correctDraft(draftCorrectionInputSchema.parse(args[0])) })
  ipcMain.handle('draft:add-item', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected draft item input'); return await workspace!.api.addDraftItem(addDraftItemInputSchema.parse(args[0])) })
  ipcMain.handle('document:preview', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected job ID'); return workspace!.api.getCanonicalDocument(analysisIdSchema.parse(args[0])) })
  ipcMain.handle('document:measure', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 1) throw new Error('Expected job ID')
    const jobId = analysisIdSchema.parse(args[0]), document = await workspace!.api.getCanonicalDocument(jobId)
    if (!document) throw new Error('Generate a draft before measuring page fit.')
    const html = renderDocumentHtml(document), pdfWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
    try {
      await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      await pdfWindow.webContents.executeJavaScript('document.fonts.ready')
      const pdf = await pdfWindow.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } })
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true })
      const parsedPdf = await loadingTask.promise
      const extractedText: string[] = [], linkTargets = new Set<string>()
      for (let pageNumber = 1; pageNumber <= parsedPdf.numPages; pageNumber++) {
        const page = await parsedPdf.getPage(pageNumber)
        const textContent = await page.getTextContent()
        extractedText.push(...textContent.items.flatMap(item => 'str' in item && item.str.trim() ? [item.str.trim()] : []))
        const annotations = await page.getAnnotations({ intent: 'display' })
        for (const annotation of annotations) if (annotation.subtype === 'Link' && annotation.url) linkTargets.add(annotation.url)
      }
      const actualPages = parsedPdf.numPages
      await loadingTask.destroy()
      if (!actualPages || !extractedText.length) throw new Error('Electron PDF has no measurable pages or extractable selectable text.')
      const entries = document.sections.flatMap(section => section.entries.map(entry => ({ entryId: entry.id, label: entry.heading, section: section.name })))
      const report = await workspace!.api.saveDocumentFitReport(jobId, { documentHash: createHash('sha256').update(JSON.stringify(document)).digest('hex'), targetPages: document.targetPages, actualPages, extractedText, linkTargets: [...linkTargets], overflow: actualPages > document.targetPages, proposedCuts: actualPages > document.targetPages ? entries.slice(1).reverse() : [], measuredAt: new Date().toISOString() })
      return report
    } finally { pdfWindow.destroy() }
  })
  ipcMain.handle('document:export-pdf', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected job ID')
    const jobId = analysisIdSchema.parse(args[0])
    const guarded = await workspace!.api.assertDraftExportable(jobId)
    if (!guarded.ok || !guarded.document) return { ok: false, cancelled: false, message: guarded.message }
    const canonical = guarded.document, job = await workspace!.api.openJob(jobId)
    if (!job) return { ok: false, cancelled: false, message: 'The saved job is no longer available.' }
    const destination = await dialog.showSaveDialog(window!, { title: 'Export approved CV as PDF', defaultPath: pdfFilename(canonical.identity.name, job.company, job.title), filters: [{ name: 'PDF document', extensions: ['pdf'] }] })
    if (destination.canceled || !destination.filePath) return { ok: false, cancelled: true, message: 'PDF export cancelled.' }
    let overwriteApproved = false
    try {
      if (existsSync(destination.filePath)) {
        const overwrite = await dialog.showMessageBox(window!, { type: 'warning', buttons: ['Cancel', 'Replace file'], defaultId: 0, cancelId: 0, title: 'Replace existing PDF?', message: 'A file already exists at this location.', detail: 'Replace it only after the new PDF has rendered and passed local checks.' })
        if (overwrite.response !== 1) return { ok: false, cancelled: true, message: 'PDF export cancelled; the existing file was kept.' }
        overwriteApproved = true
      }
      const pdfWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
      let pdf: Buffer
      try {
        await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderDocumentHtml(canonical))}`)
        await pdfWindow.webContents.executeJavaScript('document.fonts.ready')
        pdf = await pdfWindow.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } })
      } finally { pdfWindow.destroy() }
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true })
      const parsed = await loadingTask.promise
      const extracted: string[] = [], links = new Set<string>()
      for (let pageNo = 1; pageNo <= parsed.numPages; pageNo++) {
        const page = await parsed.getPage(pageNo)
        extracted.push(...(await page.getTextContent()).items.flatMap(item => 'str' in item && item.str.trim() ? [item.str.trim()] : []))
        for (const annotation of await page.getAnnotations({ intent: 'display' })) if (annotation.subtype === 'Link' && annotation.url) links.add(annotation.url)
      }
      await loadingTask.destroy()
      if (!parsed.numPages || parsed.numPages > canonical.targetPages || !extracted.length) throw new Error('The rendered PDF failed selectable-text or page-target checks.')
      const requiredText = [canonical.identity.name, ...(canonical.identity.headline ? [canonical.identity.headline] : []), ...canonical.identity.contact, ...canonical.identity.links.map(link => link.label), ...canonical.sections.flatMap(section => [section.name, ...section.entries.flatMap(entry => [entry.heading, ...(entry.dates ? [entry.dates] : []), ...(entry.organization ? [entry.organization] : []), entry.text, ...entry.links.map(link => link.label)])])]
      if (!containsPdfTextInOrder(extracted, requiredText)) throw new Error('The rendered PDF content or reading order did not match the approved CV.')
      const requiredLinks = [...canonical.identity.links, ...canonical.sections.flatMap(section => section.entries.flatMap(entry => entry.links))].map(link => link.url)
      if (requiredLinks.some(url => !links.has(url))) throw new Error('A PDF hyperlink target did not survive local validation.')
      const latest = await workspace!.api.assertDraftExportable(jobId)
      if (!latest.ok || !latest.document || JSON.stringify(latest.document) !== JSON.stringify(canonical)) throw new Error('The approved CV changed during export. No file was written.')
      writePdfAtomically(destination.filePath, pdf, overwriteApproved)
      return { ok: true, cancelled: false, message: 'Approved PDF saved and checked locally.' }
    } catch (error) {
      return { ok: false, cancelled: false, message: error instanceof Error ? error.message : 'PDF export failed; no success was reported.' }
    }
  })
  ipcMain.handle('document:fit:get', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected job ID'); return workspace!.api.getDocumentFitReport(analysisIdSchema.parse(args[0])) })
  ipcMain.handle('document:cuts:accept', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 3 || typeof args[1] !== 'string' || !Array.isArray(args[2]) || !args[2].every(id => typeof id === 'string')) throw new Error('Expected job ID, document hash and accepted cut IDs'); return workspace!.api.acceptDocumentCuts(analysisIdSchema.parse(args[0]), args[1], args[2]) })
  ipcMain.handle('analysis:cancel', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected job ID'); return analysisResultSchema.parse(await workspace!.api.cancelAnalysis(analysisIdSchema.parse(args[0]))) })
  ipcMain.handle('analysis:usage', async (event, ...args: unknown[]) => { trusted(event); if (args.length) throw new Error('Unexpected arguments'); return analysisUsageSchema.parse(await workspace!.api.getAnalysisUsage()) })
  ipcMain.handle('analysis:budgets:set', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected analysis budgets'); return analysisUsageSchema.parse(await workspace!.api.setAnalysisBudgets(analysisBudgetsSchema.parse(args[0]))) })
  ipcMain.handle('jobs:open', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected job ID')
    const id = uuidSchema.safeParse(args[0])
    if (!id.success) throw new Error('Invalid job ID')
    const job = await workspace!.api.openJob(id.data)
    return job === null ? null : jobRecordSchema.parse(job)
  })

  window = new BrowserWindow({
    width: 1400, height: 900, minWidth: 640, minHeight: 560,
    show: false,
    backgroundColor: '#f3f5f8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'https://openrouter.ai/privacy') void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.once('ready-to-show', () => window?.show())
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => workspace?.close())
