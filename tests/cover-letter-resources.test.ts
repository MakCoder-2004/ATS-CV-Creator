import { expect, test } from 'vitest'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createCoverLetterCompiler } from '../src/main/cover-letter-compiler'
import { artifactFixture } from './helpers/cover-letter-artifact'
import { projectCoverLetter } from '../src/shared/cover-letter-document'
import { assertCoverLetterPdfContent, inspectCoverLetterPdf } from '../src/main/cover-letter-pdf'

test('configured extraResources stage exact adapted template/manifest and explicit upstream, ancestor, font and application notices', async () => {
  const root = await mkdtemp(join(tmpdir(), 'letter-resource staging-')), f = await artifactFixture()
  try {
    const config = JSON.parse(await readFile('package.json', 'utf8')) as { build: { extraResources: Array<{ from: string; to: string }> } }
    const destinations = ['cover-letter-template/application', 'licenses/cover-letter/upstream-MIT.txt', 'licenses/cover-letter/ancestor-MIT.txt', 'licenses/cover-letter/NOTICES.txt', 'licenses/cover-letter/Lato-OFL.txt']
    for (const destination of destinations) {
      const resource = config.build.extraResources.find(item => item.to === destination)
      expect(resource, destination).toBeDefined()
      await cp(resource!.from, join(root, resource!.to), { recursive: true })
    }
    const templateRoot = join(root, 'cover-letter-template/application')
    expect(await readFile(join(templateRoot, 'assets.json'))).toEqual(await readFile('resources/cover-letter-template/application/assets.json'))
    expect(await readFile(join(templateRoot, 'cover-letter.tex'))).toEqual(await readFile('resources/cover-letter-template/application/cover-letter.tex'))
    const compiler = createCoverLetterCompiler({ toolchainRoot: resolve('.tools/latex'), templateRoot, tempRoot: join(root, 'temporary') })
    const letter = projectCoverLetter(f.letter, { fullName: 'Zoë Resource Test', email: 'zoe@example.test' }, await compiler.getTemplateIdentity())
    assertCoverLetterPdfContent(letter, await inspectCoverLetterPdf((await compiler.compile(letter)).pdf))
    expect(await readFile(join(root, 'licenses/cover-letter/NOTICES.txt'), 'utf8')).toContain('Word may reflow')
  } finally { f.cleanup(); await rm(root, { recursive: true, force: true }) }
}, 30_000)
