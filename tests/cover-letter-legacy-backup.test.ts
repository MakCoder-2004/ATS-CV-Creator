import { afterEach, expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createWorkbench } from '../src/main/workbench'

const fixture = readFileSync(join(process.cwd(), 'tests/fixtures/cover-letter-legacy/original-v3.workspace.json'), 'utf8')
const workspaces: Array<{ directory: string; workspace: ReturnType<typeof createWorkbench> }> = []
function openWorkspace() {
  const directory = mkdtempSync(join(tmpdir(), 'cover-letter-original-v3-'))
  const workspace = createWorkbench(directory, undefined, { generate: async () => { throw new Error('Restoring a legacy fixture must not dispatch a provider request') } })
  workspaces.push({ directory, workspace })
  return workspace
}
afterEach(() => {
  for (const { directory, workspace } of workspaces.splice(0)) {
    workspace.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a captured pre-letter v3 backup restores its actual career facts and posting', async () => {
  expect(createHash('sha256').update(fixture).digest('hex')).toBe('d905efcc3bc4cfa70ddb8c5669cfa13b11f0eeb4250fe3764cdf60c1e4b81641')
  const workspace = openWorkspace()
  const preview = workspace.backup.previewRestore(fixture)
  workspace.backup.applyRestore(preview.token, content => content)
  const profile = await workspace.api.getProfile()
  expect(profile.contact).toMatchObject({ fullName: 'Legacy Fixture Candidate', email: 'legacy@example.test' })
  expect(profile.skills.map(skill => skill.name)).toEqual(['Python'])
  expect((await workspace.api.getExperience()).experience).toEqual([expect.objectContaining({ title: 'Software Engineer', organization: 'Legacy Fixture Employer' })])
  expect(await workspace.api.listJobs()).toEqual([expect.objectContaining({ title: 'Platform Engineer', company: 'Legacy Fixture Target' })])
})

test('the released v3 pre-job-ownership shape still upgrades through its known migration', async () => {
  const workspace = openWorkspace()
  const historical = JSON.parse(fixture)
  historical.tables.schema_migrations.rows = historical.tables.schema_migrations.rows.filter((row: { version: number }) => row.version !== 10)
  historical.tables.outbound_consents.schema = historical.tables.outbound_consents.schema.replace(', job_id TEXT)', ')')
  const preview = workspace.backup.previewRestore(JSON.stringify(historical))
  workspace.backup.applyRestore(preview.token, content => content)
  expect((await workspace.api.getProfile()).contact?.fullName).toBe('Legacy Fixture Candidate')
  expect(await workspace.api.listJobs()).toEqual([expect.objectContaining({ title: 'Platform Engineer' })])
})

test('a legacy transform must not launder a corrupted original consent table definition', () => {
  const workspace = openWorkspace()
  const corrupted = JSON.parse(fixture)
  corrupted.tables.outbound_consents.schema = corrupted.tables.outbound_consents.schema.replace('scope_hash TEXT NOT NULL', 'scope_hash INTEGER')
  expect(() => workspace.backup.previewRestore(JSON.stringify(corrupted))).toThrow()
})
