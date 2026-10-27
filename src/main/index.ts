import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import type { ZodError } from 'zod'
import { fileURLToPath } from 'node:url'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { appendFileSync, existsSync, linkSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pdfFilename, writePdfAtomically } from '../shared/export'
import { removeRepeatedEntryHeading } from '../shared/document'
import { createLatexCompiler, hashDocument } from './latex-compiler'
import { assertCompiledContent, inspectCompiledPdf } from './pdf-document'
import { renderCanonicalDocx } from './docx-export'
import { z } from 'zod'
import { createWorkbench } from './workbench'
import type { PiModelRuntime } from './pi-model'
import { piModelPreferenceInputSchema } from '../shared/pi-model'
import type { AnalysisTransport } from './posting-analysis'
import { appearanceSchema } from '../shared/appearance'
import { contactSaveInputSchema, evidenceRevisionSchema, profileEntrySaveSchema, profileMutationResultSchema, profileSnapshotSchema, skillSaveInputSchema, uuidSchema } from '../shared/profile'
import { experienceSaveInputSchema, experienceSnapshotSchema, experienceMutationResultSchema, projectSaveInputSchema } from '../shared/experience'
import { hasSavedJobApplicationUrlInput, jobRecordSchema, jobSaveInputSchema, jobSaveResultSchema, jobDeletionSelectionSchema, jobDeletionExecuteSchema, jobDeletionPreviewSchema, jobDeletionResultSchema, httpsProfileUrlSchema } from '../shared/jobs'
import { arePublicContactProfileAddresses } from './contact-profile-safety'
import { registerProfileExchangeIpc } from './profile-exchange-ipc'
import { registerProfilePdfImportIpc } from './profile-pdf-import-ipc'
import { registerProfileDocxImportIpc } from './profile-docx-import-ipc'
import { registerWorkspaceBackupIpc } from './workspace-backup-ipc'
import { registerResearchSearchSettingsIpc } from './research-search-settings-ipc'
import { createResearchSearchCredentials, defaultResearchCredentialDirectory } from './research-search-credentials'
import { outboundConsentActionSchema, outboundConsentPreviewSchema } from '../shared/outbound-consent-contract'
import { analysisIdSchema, analysisResultSchema, analysisStartInputSchema, generationRecoverySchema, recoveryChoiceSchema } from '../shared/posting-analysis'
import { addDraftItemInputSchema, draftCorrectionInputSchema, draftGenerationSchema, draftRevisionSchema, suggestedSkillDecisionSchema, draftTailoringCorrectionSchema } from '../shared/draft'
import { factualCheckReportSchema } from '../shared/factual-report'
import { regenerationProposalSchema, regenerationResultSchema, regenerationTargetSchema } from '../shared/regeneration'
import { mutateDraftRecordInputSchema } from '../shared/draft-records'

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

// Test-only paths are set before readiness and credential construction. Never use an
// inherited Windows APPDATA location for a test that saves a synthetic search key.
if (!app.isPackaged && process.env.CV_TAILOR_TEST_APP_DATA_DIR) {
  const root = process.env.CV_TAILOR_TEST_STORAGE_ROOT
  const appData = process.env.CV_TAILOR_TEST_APP_DATA_DIR
  const userData = process.env.CV_TAILOR_TEST_USER_DATA_DIR
  if (!root || !userData ||
      realpathSync.native(appData) !== realpathSync.native(join(root, 'appdata')) ||
      realpathSync.native(userData) !== realpathSync.native(join(root, 'workspace')) ||
      realpathSync.native(appData) === realpathSync.native(userData)) {
    throw new Error('Test credential storage must use separate existing siblings inside the test root.')
  }
  app.setPath('appData', appData)
}
// The test override is disabled in packaged builds; production always uses Electron's userData.
if (!app.isPackaged && process.env.CV_TAILOR_TEST_USER_DATA_DIR) {
  mkdirSync(process.env.CV_TAILOR_TEST_USER_DATA_DIR, { recursive: true })
  app.setPath('userData', process.env.CV_TAILOR_TEST_USER_DATA_DIR)
}
app.whenReady().then(() => {
  const compiler = createLatexCompiler({
    toolchainRoot: app.isPackaged ? join(process.resourcesPath, 'latex') : join(__dirname, '../..', '.tools', 'latex'),
    templateRoot: app.isPackaged ? join(process.resourcesPath, 'cv-template') : join(__dirname, '../..', 'resources', 'cv-template'),
    tempRoot: join(app.getPath('temp'), 'cv-tailor-pdf')
  })
  let scriptedAttempts = 0
  let recoveryFailureSent = false
  const scriptedAnalysis: AnalysisTransport | undefined = !app.isPackaged && ['1', 'retry', 'generation', 'factual', 'invalid', 'foreign-citation', 'recovery', 'delayed', 'tailored-flow', 'profile-ai', 'profile-ai-delayed', 'profile-ai-wrong-fact', 'profile-ai-late', 'profile-ai-malformed', 'profile-ai-provider-failure'].includes(process.env.CV_TAILOR_SCRIPTED_ANALYSIS ?? '') ? { generate: async ({ prompt, signal }) => {
    scriptedAttempts++
    if (process.env.CV_TAILOR_TEST_MODEL_DISPATCH_LOG) {
      const operation = prompt.startsWith('Organize only facts') ? 'profile-import'
        : prompt.startsWith('Score these numbered') ? 'evidence-scoring'
          : prompt.startsWith('Propose conservative replacement wording') ? 'regeneration'
            : prompt.startsWith('Extract only explicit qualifications') || prompt.startsWith('Extract only explicitly stated role responsibilities') ? 'qualification-extraction'
            : prompt.startsWith('Factual repair cycle') ? 'factual-repair'
              : /^Write (?:conservative|concise)/.test(prompt) ? 'generation' : 'other'
      appendFileSync(join(app.getPath('userData'), process.env.CV_TAILOR_TEST_MODEL_DISPATCH_LOG), `${operation}\n`)
    }
    const isTailoring = /^Write (?:conservative|concise)/.test(prompt)
    if (process.env.CV_TAILOR_SCRIPTED_ANALYSIS === 'profile-ai-delayed' && prompt.startsWith('Organize only facts')) return await new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('scripted request cancelled'), { code: 'ECONNRESET' })), { once: true }))
    if (process.env.CV_TAILOR_SCRIPTED_ANALYSIS === 'profile-ai-malformed' && prompt.startsWith('Organize only facts')) return '{not-json'
    if (process.env.CV_TAILOR_SCRIPTED_ANALYSIS === 'profile-ai-provider-failure' && prompt.startsWith('Organize only facts')) throw new Error('scripted provider unavailable')
    if (process.env.CV_TAILOR_SCRIPTED_ANALYSIS === 'profile-ai-late' && prompt.startsWith('Organize only facts')) await new Promise<void>(resolve => setTimeout(resolve, 1_500))
    if (['profile-ai', 'profile-ai-wrong-fact', 'profile-ai-late'].includes(process.env.CV_TAILOR_SCRIPTED_ANALYSIS ?? '') && prompt.startsWith('Organize only facts')) {
      if (['ada@example.test', '+1 555 123 4567', '%PDF', 'PROFILE_SECRET_CANARY'].some(value => prompt.includes(value))) throw new Error('The scripted outbound request contained unapproved source data.')
      const authorized = prompt.split('AUTHORIZED CV SOURCE TEXT (this exact minimized text only):\n')[1] ?? ''
      const units = authorized.split(/\n\n(?=\[page-\d+-passage-\d+\s·)/).flatMap(block => {
        const match = block.match(/^\[(page-\d+-passage-\d+)[^\]]*\]\n([\s\S]*)$/)
        return match ? [{ unitId: match[1]!, text: match[2]! }] : []
      })
      const used = new Set<string>(), citations: Array<{ proposalRef: string; unitId: string }> = []
      const cite = (ref: string, unit: { unitId: string }) => { citations.push({ proposalRef: ref, unitId: unit.unitId }); used.add(unit.unitId) }
      const find = (pattern: RegExp) => units.find(item => pattern.test(item.text))
      const name = find(/^NAME:\s*/i), email = find(/^EMAIL:\s*/i), phone = find(/^PHONE:\s*/i)
      const contact = name || email || phone ? { proposalRef: 'ai-contact', ...(name ? { fullName: name.text.replace(/^NAME:\s*/i, '').trim() } : {}), ...(email ? { email: email.text.replace(/^EMAIL:\s*/i, '').trim() } : {}), ...(phone ? { phone: phone.text.replace(/^PHONE:\s*/i, '').trim() } : {}) } : undefined
      if (name) cite('ai-contact', name)
      if (email) cite('ai-contact', email)
      if (phone) cite('ai-contact', phone)
      const skillSource = find(/^SKILLS:\s*/i), skillName = skillSource?.text.replace(/^SKILLS:\s*/i, '').split(/[\n,;|]/)[0]?.trim()
      const skill = process.env.CV_TAILOR_SCRIPTED_ANALYSIS === 'profile-ai-wrong-fact' ? 'Rust' : skillName
      const skills = skill ? [{ name: skill, category: 'Technical', proposalRef: 'ai-skill-1' }] : []
      if (skillSource && skill) cite('ai-skill-1', skillSource)
      const roleSource = find(/^EXPERIENCE:\s*/i), roleParts = roleSource?.text.replace(/^EXPERIENCE:\s*/i, '').split(/\s+\|\s+/)
      const roleFact = find(/^FACT:\s*/i)
      const experience = roleParts?.length === 3 ? [{ kind: 'employment', organization: roleParts[0], title: roleParts[1], startDate: roleParts[2]?.split(/\s+[-–]\s+/)[0], endDate: roleParts[2]?.split(/\s+[-–]\s+/)[1], description: roleSource!.text, factualItems: roleFact ? [{ text: roleFact.text.replace(/^FACT:\s*/i, '').trim(), proposalRef: 'ai-role-fact' }] : [], proposalRef: 'ai-role' }] : []
      if (experience.length && roleSource) cite('ai-role', roleSource)
      if (experience.length && roleFact) cite('ai-role-fact', roleFact)
      const projectSource = find(/^PROJECT:\s*/i), projectParts = projectSource?.text.replace(/^PROJECT:\s*/i, '').split(/\s+\|\s+/)
      const projectLink = find(/^PROJECT LINK:\s*/i)
      const projectIndex = projectSource ? units.indexOf(projectSource) : -1
      const projectFact = projectIndex >= 0 ? units[projectIndex + 1] : undefined
      const factualProjectText = projectFact && !/^(?:PROJECT LINK:|EDUCATION:|UNKNOWN:|INSTRUCTIONS:|EXPERIENCE:|FACT:|SKILLS:)/i.test(projectFact.text) ? projectFact.text.trim() : undefined
      const educationSource = find(/^EDUCATION:\s*/i), educationParts = educationSource?.text.replace(/^EDUCATION:\s*/i, '').split(/\s+\|\s+/)
      const entries = educationParts?.length === 3 ? [{ section: 'education', title: educationParts[0], institution: educationParts[1], startDate: educationParts[2]?.split(/\s+[-–]\s+/)[0], endDate: educationParts[2]?.split(/\s+[-–]\s+/)[1], proposalRef: 'ai-education' }] : []
      if (entries.length && educationSource) cite('ai-education', educationSource)
      const link = projectLink?.text.match(/^PROJECT LINK:\s*([^\n|]+)(?:\s*\|\s*([^\n]+))?(?:\nLink:\s*[^\n]+\s+—\s+(https?:\/\/\S+))?/i)
      const attachedLink = projectLink?.text.match(/(?:^|\n)Link:\s*(.*?)\s+—\s+(https?:\/\/\S+)/i)
      const projectUrl = attachedLink?.[2] ?? link?.[2], projectLabel = attachedLink?.[1] ?? link?.[1]
      const projects = projectParts?.length === 2 ? [{ name: projectParts[0], description: projectSource!.text, factualItems: factualProjectText ? [{ text: factualProjectText, proposalRef: 'ai-project-fact' }] : [], technologies: [{ text: projectParts[1], proposalRef: 'ai-project-technology' }], links: projectUrl && projectLabel ? [{ label: projectLabel.trim(), url: projectUrl.trim() }] : [], proposalRef: 'ai-project' }] : []
      if (projects.length && projectSource) { cite('ai-project', projectSource); cite('ai-project-technology', projectSource) }
      if (projects.length && projectLink) cite('ai-project', projectLink)
      if (projects.length && factualProjectText && projectFact) cite('ai-project-fact', projectFact)
      return JSON.stringify({ ...(contact ? { contact } : {}), skills, experience, projects, entries, citations, unmappedUnitIds: units.filter(item => !used.has(item.unitId)).map(item => item.unitId) })
    }
    if (process.env.CV_TAILOR_SCRIPTED_ANALYSIS === 'delayed' && isTailoring) await new Promise<void>(resolve => setTimeout(resolve, 30000))
    if (process.env.CV_TAILOR_SCRIPTED_ANALYSIS === 'recovery' && isTailoring && !recoveryFailureSent) { recoveryFailureSent = true; throw Object.assign(new Error('scripted offline interruption'), { code: 'ECONNRESET' }) }
    if (prompt.startsWith('Factual repair cycle')) return JSON.stringify({ corrections: [] })
    if (prompt.startsWith('Propose conservative replacement wording')) { const { sourcesByItem } = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ items: sourcesByItem.map(() => ({ text: 'Rephrased within the authorized evidence.', rationale: 'Rephrased only within the currently cited evidence.' })) }) }
    if (process.env.CV_TAILOR_SCRIPTED_ANALYSIS === 'retry' && scriptedAttempts === 1) throw { status: 429, retryAfter: 3 }
    if (['generation', 'factual', 'invalid', 'foreign-citation', 'recovery', 'delayed', 'tailored-flow'].includes(process.env.CV_TAILOR_SCRIPTED_ANALYSIS ?? '') && prompt.startsWith('Score these numbered')) {
      const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 0.9, rationale: 'Directly supports the posting.' })) })
    }
    if (process.env.CV_TAILOR_SCRIPTED_ANALYSIS === 'invalid' && isTailoring) return '{ malformed response'
    if (process.env.CV_TAILOR_SCRIPTED_ANALYSIS === 'foreign-citation' && isTailoring) {
      const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{'), prompt.lastIndexOf('}') + 1)) as { selected: Array<{ category: string }> }
      return JSON.stringify({ education: [], experience: selected.some(item => item.category === 'experience') ? [{ text: 'Unsupported suggestion.', evidence: [selected.length + 7], rationale: 'Foreign source.' }] : [], projects: [], skills: [] })
    }
    if (['generation', 'factual', 'invalid', 'recovery', 'delayed', 'tailored-flow'].includes(process.env.CV_TAILOR_SCRIPTED_ANALYSIS ?? '') && isTailoring) {
      const { selected, experienceGroups, projectGroups } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      const sourceWording = (text: string) => { try { const item = JSON.parse(text); return removeRepeatedEntryHeading(item.description || item.text || item.field || item.title || item.name || text, item.title ?? item.name ?? '', item.organization) || item.title || item.name || text } catch { return text } }
      const paragraphs = (category: string) => {
        const groups: Array<{ indexes: number[] }> = category === 'experience' ? experienceGroups : category === 'projects' ? projectGroups : selected.filter((item: { category: string }) => item.category === category).map((item: { index: number }) => ({ indexes: [item.index] }))
        return groups.map(group => {
          const item = selected.find((source: { index: number }) => group.indexes.includes(source.index))
          return { text: process.env.CV_TAILOR_SCRIPTED_ANALYSIS === 'factual' && category === 'experience' ? 'Reduced delivery time by 900 percent.' : sourceWording(item.text), evidence: [item.index], rationale: 'Selected from authorized profile evidence.' }
        })
      }
      const skills = selected.filter((item: { category: string }) => item.category === 'skills').map((item: { index: number; text: string }) => ({ name: JSON.parse(item.text).name, evidence: [item.index], rationale: 'Selected from the saved skill inventory.' }))
      return JSON.stringify({ education: paragraphs('education'), experience: paragraphs('experience'), projects: paragraphs('projects'), skills })
    }
    if (process.env.CV_TAILOR_SCRIPTED_ANALYSIS === 'tailored-flow') return JSON.stringify({ required: ['Python', 'RASA', 'Google Cloud Platform', 'NLP'], preferred: ['Docker'], tools: ['Python', 'RASA', 'Google Cloud Platform', 'spaCy', 'Git', 'Docker'], responsibilities: ['Build Python APIs and conversational AI solutions'], keywords: ['Python', 'NLP', 'intent classification', 'model evaluation', 'backend services'] })
    return JSON.stringify({ required: ['TypeScript', 'Kubernetes'], preferred: ['Cloud architecture'], tools: ['TypeScript'], responsibilities: ['Build reliable services'], keywords: ['TypeScript', 'Kubernetes', 'Cloud architecture'] })
  } } : undefined
  const useScriptedPi = Boolean(scriptedAnalysis && !app.isPackaged && process.env.CV_TAILOR_SCRIPTED_PI_MODEL === '1')
  const piRuntime = useScriptedPi
    ? Promise.resolve((() => {
      const model = { provider: 'scripted', id: 'cv-tailor-fixture', name: 'Offline test model', api: 'openai-completions', input: ['text'], reasoning: true, contextWindow: 16384, maxTokens: 8192 }
      const alternate = { ...model, id: 'cv-tailor-fixture-alt' }
      return {
        getProviders: () => [{ id: model.provider, getModels: () => [model, alternate] }],
        getPhysicalModel: (providerId: string, modelId: string) => providerId === model.provider ? [model, alternate].find(item => item.id === modelId) : undefined,
        getAvailable: async () => [model, alternate], getAuth: async () => ({ source: 'synthetic' }),
        completeSimple: async (selected: { provider: string; id: string }, context: { messages: Array<{ role: string; content: string }> }, options: { signal?: AbortSignal }) => {
          const prompt = context.messages.find(message => message.role === 'user')?.content
          if (!prompt) throw new Error('The scripted Pi request has no prompt.')
          const text = await scriptedAnalysis!.generate({ model: 'scripted/cv-tailor-fixture', prompt, signal: options.signal ?? new AbortController().signal, responseSchema: z.unknown() })
          return { role: 'assistant', provider: selected.provider, model: selected.id, stopReason: 'stop', content: [{ type: 'text', text }], usage: { output: Math.ceil(Buffer.byteLength(text, 'utf8') / 4) } }
        }
      } as unknown as PiModelRuntime
    })())
    : import('@earendil-works/pi-coding-agent')
      .then(({ ModelRuntime }) => ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false }))
      .catch(() => null)
  workspace = createWorkbench(app.getPath('userData'), undefined, useScriptedPi ? undefined : scriptedAnalysis, undefined, piRuntime)
  let modelUpdatePending = false
  registerWorkspaceBackupIpc(() => window!, () => workspace!, () => {
    const reopened = createWorkbench(app.getPath('userData'), undefined, useScriptedPi ? undefined : scriptedAnalysis, undefined, piRuntime)
    const previous = workspace!
    workspace = reopened
    previous.close()
  }, trusted)
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
  ipcMain.handle('settings:pi-model', (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected Pi model selection')
    const input = piModelPreferenceInputSchema.parse(args[0])
    if (modelUpdatePending) throw new Error('Wait for the current Pi model selection to finish.')
    modelUpdatePending = true
    return workspace!.api.setPiModel(input).finally(() => {
      modelUpdatePending = false
    })
  })
  registerProfileExchangeIpc(() => window!, () => workspace!.api, trusted)
  const profilePdfImport = registerProfilePdfImportIpc(() => window!, () => workspace!.api, trusted)
  const profileDocxImport = registerProfileDocxImportIpc(() => window!, () => workspace!.api, trusted, profilePdfImport.clearAiForImport)
  app.on('before-quit', () => { profilePdfImport.clear(); profileDocxImport.clear() })
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
    if (hasSavedJobApplicationUrlInput(args[0])) return jobSaveResultSchema.parse({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Job application URLs are not accepted in manual intake.', fieldErrors: { 'optionalDetails.applicationUrl': 'Remove this URL; saved jobs are entered manually.' } } })
    const input = jobSaveInputSchema.safeParse(args[0])
    if (!input.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of input.error.issues) fieldErrors[issue.path.length ? issue.path.join('.') : '_'] = issue.message
      return jobSaveResultSchema.parse({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Check the highlighted job and contact fields.', fieldErrors } })
    }
    return jobSaveResultSchema.parse(await workspace!.api.saveJob(input.data))
  })
  ipcMain.handle('contacts:open-profile', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 2) throw new Error('Choose a saved job contact profile to open.')
    const jobId = uuidSchema.parse(args[0]), contactId = uuidSchema.parse(args[1])
    const job = await workspace!.api.openJob(jobId)
    const contact = job?.contacts.find(item => item.id === contactId)
    if (!contact?.profileUrl) return { ok: false, message: 'This contact no longer has a saved profile link.' }
    const url = httpsProfileUrlSchema.parse(contact.profileUrl)
    const target = new URL(url), host = target.hostname.replace(/^\[|\]$/g, '')
    // The explicit click triggers DNS safety validation only; this does not fetch profile content or pin the browser's later resolution.
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true })
    if (!arePublicContactProfileAddresses(addresses.map(address => address.address))) return { ok: false, message: 'This profile host does not resolve only to public addresses. Nothing was opened.' }
    await shell.openExternal(url)
    return { ok: true, message: 'Opened the saved contact profile in your default browser. The browser controls redirects and final addresses.' }
  })
  ipcMain.handle('jobs:delete:preview', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 1) throw new Error('Expected saved job selection')
    return jobDeletionPreviewSchema.parse(await workspace!.api.previewJobDeletion(jobDeletionSelectionSchema.parse(args[0])))
  })
  ipcMain.handle('jobs:delete:execute', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 1) throw new Error('Expected deletion confirmation')
    const input = jobDeletionExecuteSchema.parse(args[0])
    return jobDeletionResultSchema.parse(await workspace!.api.executeJobDeletion(input.token, input.jobIds))
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
  ipcMain.handle('draft:renew-review', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected job ID'); return draftGenerationSchema.parse(await workspace!.api.renewDraftReview(analysisIdSchema.parse(args[0]))) })
  ipcMain.handle('draft:regenerate', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 2) throw new Error('Expected consent token and regeneration target'); return regenerationResultSchema.parse(await workspace!.api.regenerateDraft(analysisStartInputSchema.parse({ consentToken: args[0] }).consentToken, regenerationTargetSchema.parse(args[1]))) })
  ipcMain.handle('draft:regeneration:get', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected job ID'); const proposal = await workspace!.api.getRegenerationProposal(analysisIdSchema.parse(args[0])); return proposal === null ? null : regenerationProposalSchema.parse(proposal) })
  ipcMain.handle('document:export-docx', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 1) throw new Error('Expected job ID')
    const jobId = analysisIdSchema.parse(args[0]), release = workspace!.beginJobOperation(jobId, 'DOCX export')
    try {
    const guarded = await workspace!.api.assertDraftExportable(jobId)
    if (!guarded.ok || !guarded.document) return { ok: false, cancelled: false, message: guarded.message }
    const document = guarded.document
    const job = await workspace!.api.openJob(jobId)
    const safePart = (value: string) => value.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/g, '').trim().slice(0, 60)
    const safeName = [safePart(document.identity.name), safePart(job?.company ?? ''), safePart(job?.title ?? '')].filter(Boolean).join(' - ') || 'Tailored CV'
    const { canceled, filePath } = await dialog.showSaveDialog(window!, { title: 'Save editable CV', defaultPath: `${safeName}.docx`, buttonLabel: 'Save DOCX', filters: [{ name: 'Word document', extensions: ['docx'] }] })
    if (canceled || !filePath) return { ok: false, cancelled: true, message: 'DOCX export cancelled.' }
    const target = filePath
    if (extname(target).toLowerCase() !== '.docx') return { ok: false, cancelled: false, message: 'Choose a destination ending in .docx. No file was written.' }
    const beforeDialogDocument = JSON.stringify(document)
    const guardedAfterDialog = await workspace!.api.assertDraftExportable(jobId)
    if (!guardedAfterDialog.ok || !guardedAfterDialog.document || JSON.stringify(guardedAfterDialog.document) !== beforeDialogDocument) return { ok: false, cancelled: false, message: 'The approved document changed while choosing a destination. Review and approve it again before export.' }
    let priorFile: ReturnType<typeof lstatSync> | undefined
    try { priorFile = lstatSync(target); if (!priorFile.isFile()) return { ok: false, cancelled: false, message: 'The selected destination is not a regular file.' } }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { ok: false, cancelled: false, message: `Could not inspect the destination: ${error instanceof Error ? error.message : 'unknown file error'}` } }
    if (priorFile) {
      const confirmation = await dialog.showMessageBox(window!, { type: 'warning', title: 'Replace existing DOCX?', message: 'A file already exists at this destination.', detail: 'Replace it with the currently approved CV?', buttons: ['Replace file', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true })
      if (confirmation.response !== 0) return { ok: false, cancelled: true, message: 'DOCX export cancelled. The existing file was not changed.' }
    }
    const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
    try {
      const bytes = await renderCanonicalDocx(document)
      const current = await workspace!.api.assertDraftExportable(jobId)
      if (!current.ok || !current.document || JSON.stringify(current.document) !== beforeDialogDocument) return { ok: false, cancelled: false, message: 'The approved document changed before it could be saved. Review and approve it again.' }
      writeFileSync(temporary, bytes, { flag: 'wx' })
      if (priorFile) {
        const latest = lstatSync(target)
        if (!latest.isFile() || latest.dev !== priorFile.dev || latest.ino !== priorFile.ino || latest.size !== priorFile.size || latest.mtimeMs !== priorFile.mtimeMs) throw new Error('The destination changed after overwrite confirmation. It was left untouched; choose it again to review the new file.')
        renameSync(temporary, target)
      } else {
        // Hard-link creation is atomic and fails rather than clobbering a file created after the dialog.
        linkSync(temporary, target)
        unlinkSync(temporary)
      }
      return { ok: true, cancelled: false, message: 'Editable DOCX saved. Word may reflow text differently; identical pagination is not guaranteed.', path: target }
    } catch (error) {
      try { rmSync(temporary, { force: true }) } catch { /* Preserve the original export error. */ }
      return { ok: false, cancelled: false, message: `Could not save the DOCX: ${error instanceof Error ? error.message : 'unknown file error'}` }
    }
    } finally { release() }
  })
  const measureDocumentForJob = async (jobId: string) => {
    const release = workspace!.beginJobOperation(jobId, 'page-fit measurement')
    try {
    const document = await workspace!.api.getCanonicalDocument(jobId)
    if (!document) throw new Error('Generate a draft before measuring page fit.')
    const compiled = await compiler.compile(document)
    const inspected = await inspectCompiledPdf(compiled.pdf)
    assertCompiledContent(document, inspected)
    const entries = document.sections.flatMap(section => section.entries.map(entry => ({ entryId: entry.id, label: entry.heading, section: section.name })))
    return await workspace!.api.saveDocumentFitReport(jobId, { documentHash: compiled.documentHash, targetPages: document.targetPages, ...inspected, overflow: inspected.actualPages > document.targetPages, proposedCuts: inspected.actualPages > document.targetPages ? entries.slice(1).reverse() : [], measuredAt: new Date().toISOString() })
    } finally { release() }
  }
  ipcMain.handle('draft:regeneration:resolve', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 3 || !['accept','reject'].includes(args[2] as string)) throw new Error('Expected job ID, proposal ID and decision')
    const jobId = analysisIdSchema.parse(args[0]), decision = args[2] as 'accept' | 'reject'
    const result = await workspace!.api.resolveRegenerationProposal(jobId, uuidSchema.parse(args[1]), decision)
    if (decision !== 'accept' || result.proposal?.status !== 'accepted' || !result.draft) return result
    try {
      const fit = await measureDocumentForJob(jobId)
      return { ...result, ok: true, draft: await workspace!.api.getDraft(jobId) ?? result.draft, message: `Replacement accepted; factual checks rerun. Actual Electron PDF fit checked: ${fit.actualPages} page(s), target ${fit.targetPages}. Review overflow and approve the exact document again.` }
    } catch (failure) {
      return { ...result, ok: false, message: `Replacement wording was accepted and factual checks ran, but actual PDF page fit could not be measured. Retry measurement before approval. ${failure instanceof Error ? failure.message : ''}`, draft: await workspace!.api.getDraft(jobId) ?? result.draft }
    }
  })
  ipcMain.handle('draft:get', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected job ID'); const draft = await workspace!.api.getDraft(analysisIdSchema.parse(args[0])); return draft === null ? null : draftRevisionSchema.parse(draft) })
  ipcMain.handle('draft:check', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected job ID'); const report = await workspace!.api.checkDraft(analysisIdSchema.parse(args[0])); return report === null ? null : factualCheckReportSchema.parse(report) })
  ipcMain.handle('draft:approve', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected job ID'); return workspace!.api.approveDraft(analysisIdSchema.parse(args[0])) })
  ipcMain.handle('draft:export-guard', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected job ID'); return workspace!.api.assertDraftExportable(analysisIdSchema.parse(args[0])) })
  ipcMain.handle('draft:skill-decision', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected a skill review decision'); return draftGenerationSchema.parse(await workspace!.api.decideSuggestedSkill(suggestedSkillDecisionSchema.parse(args[0]))) })
  ipcMain.handle('draft:tailoring:correct', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected tailored wording'); return draftGenerationSchema.parse(await workspace!.api.correctDraftTailoring(draftTailoringCorrectionSchema.parse(args[0]))) })
  ipcMain.handle('draft:correct', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected correction input'); return await workspace!.api.correctDraft(draftCorrectionInputSchema.parse(args[0])) })
  ipcMain.handle('draft:record:mutate', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected record mutation'); return await workspace!.api.mutateDraftRecord(mutateDraftRecordInputSchema.parse(args[0])) })
  ipcMain.handle('draft:add-item', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected draft item input'); return await workspace!.api.addDraftItem(addDraftItemInputSchema.parse(args[0])) })
  ipcMain.handle('document:preview', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected job ID'); return workspace!.api.getCanonicalDocument(analysisIdSchema.parse(args[0])) })
  ipcMain.handle('document:pdf', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 1) throw new Error('Expected job ID')
    const jobId = analysisIdSchema.parse(args[0]), release = workspace!.beginJobOperation(jobId, 'PDF preview')
    try {
    const canonical = await workspace!.api.getCanonicalDocument(jobId)
    if (!canonical) throw new Error('Create a CV before opening its PDF preview.')
    const compiled = await compiler.compile(canonical)
    assertCompiledContent(canonical, await inspectCompiledPdf(compiled.pdf))
    const current = await workspace!.api.getCanonicalDocument(jobId)
    if (!current || hashDocument(current) !== compiled.documentHash) throw new Error('The CV changed while its PDF was prepared. Open the preview again.')
    return { documentHash: compiled.documentHash, pdfBase64: compiled.pdf.toString('base64') }
    } finally { release() }
  })
  ipcMain.handle('document:measure', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 1) throw new Error('Expected job ID')
    return measureDocumentForJob(analysisIdSchema.parse(args[0]))
  })
  ipcMain.handle('document:export-pdf', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected job ID')
    const jobId = analysisIdSchema.parse(args[0]), release = workspace!.beginJobOperation(jobId, 'PDF export')
    try {
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
      const { pdf } = await compiler.compile(canonical)
      const inspected = await inspectCompiledPdf(pdf)
      assertCompiledContent(canonical, inspected)
      if (inspected.actualPages > canonical.targetPages) throw new Error('The compiled PDF exceeds the approved page target. Return to review and shorten it before exporting.')
      const latest = await workspace!.api.assertDraftExportable(jobId)
      if (!latest.ok || !latest.document || JSON.stringify(latest.document) !== JSON.stringify(canonical)) throw new Error('The approved CV changed during export. No file was written.')
      writePdfAtomically(destination.filePath, pdf, overwriteApproved)
      return { ok: true, cancelled: false, message: 'Approved PDF saved and checked locally.' }
    } catch (error) {
      return { ok: false, cancelled: false, message: error instanceof Error ? error.message : 'PDF export failed; no success was reported.' }
    }
    } finally { release() }
  })
  ipcMain.handle('document:fit:get', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected job ID'); return workspace!.api.getDocumentFitReport(analysisIdSchema.parse(args[0])) })
  ipcMain.handle('document:cuts:accept', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 3 || typeof args[1] !== 'string' || !Array.isArray(args[2]) || !args[2].every(id => typeof id === 'string')) throw new Error('Expected job ID, document hash and accepted cut IDs'); return workspace!.api.acceptDocumentCuts(analysisIdSchema.parse(args[0]), args[1], args[2]) })
  ipcMain.handle('analysis:cancel', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected job ID'); return analysisResultSchema.parse(await workspace!.api.cancelAnalysis(analysisIdSchema.parse(args[0]))) })
  ipcMain.handle('generation:recovery:get', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected job ID'); const result = await workspace!.api.getGenerationRecovery(analysisIdSchema.parse(args[0])); return result === null ? null : generationRecoverySchema.parse(result) })
  ipcMain.handle('generation:recovery:resume', async (event, ...args: unknown[]) => { trusted(event); if (args.length < 1 || args.length > 2) throw new Error('Expected run ID and optional recovery choice'); const runId = analysisIdSchema.parse(args[0]); const choice = args[1] === undefined ? undefined : recoveryChoiceSchema.parse(args[1]); return workspace!.api.resumeGeneration(runId, choice) })
  ipcMain.handle('generation:recovery:cancel', async (event, ...args: unknown[]) => { trusted(event); if (args.length !== 1) throw new Error('Expected run ID'); return workspace!.api.cancelGenerationRecovery(analysisIdSchema.parse(args[0])) })
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
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.once('ready-to-show', () => window?.show())
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => { workspace?.close() })
