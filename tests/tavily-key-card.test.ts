import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TavilyKeyCard, type TavilyKeyCardClient } from '../src/renderer/TavilyKeyCard'
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
  it('does not render a key or configured controls before status resolves', () => {
    const html = renderToStaticMarkup(createElement(TavilyKeyCard, { client }))
    expect(html).toContain('Checking local key storage')
    expect(html).toContain('type="password"')
    expect(html).not.toContain('Saved key')
    expect(html).not.toContain('never-render-this-by-default')
  })

  it('does not display configured key details before status resolves', () => {
    const pendingClient = { ...client, getResearchSearchKeyStatus: () => new Promise<ResearchSearchKeyStatus>(() => {}) }
    const html = renderToStaticMarkup(createElement(TavilyKeyCard, { client: pendingClient }))
    expect(html).toContain('Checking local key storage')
    expect(html).not.toContain('Saved key')
  })

  it('renders a truthful failure summary and keeps confirmation inline', () => {
    const source = readFileSync(new URL('../src/renderer/TavilyKeyCard.tsx', import.meta.url), 'utf8')
    expect(source).toContain("setLoadFailed(true); setError('Tavily key status could not be loaded.")
    expect(source).toContain("loadFailed ? 'Local key status unavailable. Reopen Settings to retry.'")
    expect(source).toContain('role="group" aria-labelledby="tavily-confirm-title"')
    expect(source).not.toContain('aria-modal')
    expect(source).toContain('setConfirm(false); requestAnimationFrame(() => revokeRef.current?.focus())')
  })

  it('clears on model-context changes before paint without remounting or resetting replacement input', () => {
    const source = readFileSync(new URL('../src/renderer/TavilyKeyCard.tsx', import.meta.url), 'utf8')
    const settings = readFileSync(new URL('../src/renderer/PiSettings.tsx', import.meta.url), 'utf8')
    expect(source).toContain('useLayoutEffect(() => {')
    expect(source).toContain('}, [modelContext])')
    expect(settings).toContain('<TavilyKeyCard modelContext={`${reference}\\u0000${thinkingLevel}\\u0000${modelSaveEpoch}`} />')
    expect(settings).toContain('setModelSaveEpoch(epoch => epoch + 1)')
    expect(source).not.toContain('key={modelContext}')
    expect(source).toContain('const [keyInput, setKeyInput] = useState(\'\')')
  })

  it('provides explicit Hide during a pending reveal and invalidates its late result', () => {
    const source = readFileSync(new URL('../src/renderer/TavilyKeyCard.tsx', import.meta.url), 'utf8')
    expect(source).toContain('function hideReveal() { clearReveal(); setRevealPending(false); setBusy(false) }')
    expect(source).toContain('revealed || revealPending ? <button className="secondary-button" type="button" onClick={hideReveal}>Hide</button>')
    expect(source).toContain('if (generation.current === request) { revealedRef.current = result.key; setRevealed(result.key) }')
    expect(source).toContain('Tavily may share the public query with other search-index providers and receive network metadata. No profile data is sent.')
  })
})
