import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LegacySearchKeyCleanup, type LegacySearchKeyCleanupClient } from '../src/renderer/LegacySearchKeyCleanup'
import type { ResearchSearchKeyStatus } from '../src/shared/research-search-settings'

const absent: ResearchSearchKeyStatus = { configured: false, storageAvailable: true, message: 'No legacy encrypted search key is saved on this device.' }
const client: LegacySearchKeyCleanupClient = {
  getResearchSearchKeyStatus: async () => absent,
  removeResearchSearchKey: async () => absent
}

describe('conditional retired search-key cleanup', () => {
  it('renders no search UI while legacy-key status is loading', () => {
    const html = renderToStaticMarkup(createElement(LegacySearchKeyCleanup, { client }))
    expect(html).not.toContain('Tavily')
    expect(html).not.toContain('Search retired')
    expect(html).not.toContain('Reveal')
    expect(html).not.toContain('Copy')
    expect(html).not.toContain('Remove local key')
  })
  it('does not expose any credential reveal, copy, or save API to the renderer', async () => {
    const status = await client.getResearchSearchKeyStatus()
    expect(status).toEqual(absent)
    expect('revealResearchSearchKey' in client).toBe(false)
    expect('copyResearchSearchKey' in client).toBe(false)
    expect('saveResearchSearchKey' in client).toBe(false)
  })
})
