import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TavilyKeyCard, TavilyKeySummary, type TavilyKeyCardClient } from '../src/renderer/TavilyKeyCard'
import type { ResearchSearchKeyStatus } from '../src/shared/research-search-settings'

const present: ResearchSearchKeyStatus = { configured: true, storageAvailable: true, message: 'Search is available only after a key is stored on this device.' }
const absent: ResearchSearchKeyStatus = { configured: false, storageAvailable: true, message: 'Search is available only after a key is stored on this device.' }
const client: TavilyKeyCardClient = {
  getResearchSearchKeyStatus: async () => present,
  removeResearchSearchKey: async () => ({ ...present, configured: false }),
  revealResearchSearchKey: async () => ({ key: 'never-render-this-by-default' }),
  copyResearchSearchKey: async () => ({ ok: true, message: 'Search key copied. Clipboard contents remain outside CV Tailor until replaced.' })
}

describe('retired Tavily key recovery', () => {
  it('states search is retired and offers no save or replacement controls', () => {
    const html = renderToStaticMarkup(createElement(TavilyKeyCard, { client }))
    expect(html).toContain('Search retired')
    expect(html).not.toContain('Save Tavily key')
    expect(html).not.toContain('Replace')
    expect(html).not.toContain('never-render-this-by-default')
  })
  it('reports absent and uncertain key status truthfully', () => {
    expect(renderToStaticMarkup(createElement(TavilyKeySummary, { status: absent, loadFailed: false }))).toContain('No Tavily key is saved')
    const uncertain = { configured: false, storageAvailable: false, message: 'Search key storage failed. The existing key was not replaced.' } as ResearchSearchKeyStatus
    const text = renderToStaticMarkup(createElement(TavilyKeySummary, { status: uncertain, loadFailed: false }))
    expect(text).toContain('An existing key may still be saved')
    expect(text).not.toContain('No Tavily key is saved')
  })
  it('provides explicit recovery/removal only for an existing key', () => {
    const source = readFileSync(new URL('../src/renderer/TavilyKeyCard.tsx', import.meta.url), 'utf8')
    expect(source).toContain('Existing encrypted Tavily key')
    expect(source).toContain('>Reveal</button>')
    expect(source).toContain('>Copy</button>')
    expect(source).toContain('>Remove local key</button>')
    expect(source).toContain('does not revoke the key in your Tavily account')
    expect(source).toContain('No credential is sent to search')
    expect(source).not.toContain('Save Tavily key')
    expect(source).not.toContain('Replace')
  })
})
