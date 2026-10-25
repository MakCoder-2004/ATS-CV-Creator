import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TavilyKeyCard, TavilyKeySummary, type TavilyKeyCardClient } from '../src/renderer/TavilyKeyCard'
import type { ResearchSearchKeyStatus } from '../src/shared/research-search-settings'

const configured: ResearchSearchKeyStatus = {
  configured: true,
  storageAvailable: true,
  message: 'Search is available only after a key is stored on this device.'
}
const client: TavilyKeyCardClient = {
  getResearchSearchKeyStatus: async () => configured,
  saveResearchSearchKey: async () => configured,
  removeResearchSearchKey: async () => ({ ...configured, configured: false }),
  revealResearchSearchKey: async () => ({ key: 'never-render-this-by-default' }),
  copyResearchSearchKey: async () => ({ ok: true, message: 'Search key copied. Clipboard contents remain outside CV Tailor until replaced.' })
}

describe('TavilyKeyCard', () => {
  it('renders one field with unknown status disabled until inspection completes', () => {
    const html = renderToStaticMarkup(createElement(TavilyKeyCard, { client }))
    expect(html).toContain('Checking local key storage')
    expect(html).toContain('Key status is unknown')
    expect(html.match(/<input /g)).toHaveLength(1)
    expect(html).toContain('Tavily API key')
    expect(html).not.toContain('Saved key')
    expect(html).not.toContain('never-render-this-by-default')
  })

  it('does not display configured key details before status resolves', () => {
    const pendingClient = { ...client, getResearchSearchKeyStatus: () => new Promise<ResearchSearchKeyStatus>(() => {}) }
    const html = renderToStaticMarkup(createElement(TavilyKeyCard, { client: pendingClient }))
    expect(html).not.toContain('Replace</button>')
    expect(html).not.toContain('Revoke locally')
  })

  it('distinguishes a failed private-storage inspection from an absent key without leaking its message', async () => {
    const injectedClient: TavilyKeyCardClient = { ...client, getResearchSearchKeyStatus: async () => ({
      configured: false, storageAvailable: false,
      message: 'Search key storage failed. The existing key was not replaced.'
    }) }
    const status = await injectedClient.getResearchSearchKeyStatus()
    const html = renderToStaticMarkup(createElement(TavilyKeySummary, { status, loadFailed: false }))
    expect(html).toContain('An existing key may still be saved')
    expect(html).toContain('Reopen Settings to retry')
    expect(html).not.toContain('No Tavily key is saved')
    expect(html).not.toContain('Secure local key storage is unavailable')
    expect(html).not.toContain(status.message)
    const source = readFileSync(new URL('../src/renderer/TavilyKeyCard.tsx', import.meta.url), 'utf8')
    expect(source).toContain('status.message !== STORAGE_FAILURE')
    expect(source).toContain('role="group" aria-labelledby="tavily-confirm-title"')
    expect(source).not.toContain('aria-modal')
  })

  it('clears on model-context changes before paint without remounting or resetting typed replacement', () => {
    const source = readFileSync(new URL('../src/renderer/TavilyKeyCard.tsx', import.meta.url), 'utf8')
    const settings = readFileSync(new URL('../src/renderer/PiSettings.tsx', import.meta.url), 'utf8')
    expect(source).toContain('useLayoutEffect(() => {')
    expect(source).toContain('}, [modelContext])')
    expect(settings).toContain('<TavilyKeyCard modelContext={`${reference}\\u0000${thinkingLevel}\\u0000${modelSaveEpoch}`} />')
    expect(source).not.toContain('key={modelContext}')
    expect(source).toContain("const [keyInput, setKeyInput] = useState('')")
    expect(source).toContain('value={editing ? keyInput : revealed} placeholder={!editing && !revealed')
  })

  it('invalidates late reveal and keeps typed key controls distinct from stored key controls', () => {
    const source = readFileSync(new URL('../src/renderer/TavilyKeyCard.tsx', import.meta.url), 'utf8')
    expect(source).toContain('function hideReveal() { clearReveal(); setRevealPending(false); setBusy(false) }')
    expect(source).toContain('if (generation.current === request) { revealedRef.current = result.key; setRevealed(result.key) }')
    expect(source).toContain("clearReveal(); setRevealPending(false); setConfirm(false); focusIntent.current = 'key'; setReplacing(true)")
    expect(source).toContain('Hide typed key')
    expect(source).toContain('Cancel replacement')
    expect(source).toContain('Tavily may share the public query with other search-index providers and receive network metadata. No profile data is sent.')
  })
})
