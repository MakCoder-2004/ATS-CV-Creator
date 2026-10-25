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
  copyResearchSearchKey: async () => ({ ok: true, message: 'Key copied.' })
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
})
