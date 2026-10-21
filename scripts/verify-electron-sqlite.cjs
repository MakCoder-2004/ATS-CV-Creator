// Packaging preflight: validate the real native binding under the application's Electron ABI.
const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')
const { existsSync } = require('node:fs')

const root = resolve(__dirname, '..')
const packaged = process.argv.includes('--packaged')
const binding = packaged ? resolve(root, 'release/win-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node') : ''
if (packaged && !existsSync(binding)) {
  console.error('Packaged SQLite binding is missing. The installer is not ready.')
  process.exit(1)
}
const result = spawnSync(require('electron'), ['-e', `
  try {
    const Database = require('better-sqlite3');
    const binding = process.env.CV_TAILOR_VERIFY_NATIVE_BINDING;
    const database = new Database(':memory:', binding ? { nativeBinding: binding } : {});
    if (database.prepare('SELECT 1 AS ok').get().ok !== 1) throw new Error('SQLite query failed');
    database.close();
    console.log('SQLite verified under Electron ABI ' + process.versions.modules);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
`], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CV_TAILOR_VERIFY_NATIVE_BINDING: binding }, encoding: 'utf8', timeout: 30000 })
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
if (result.error) console.error(result.error.message)
if (result.status !== 0) {
  console.error(`${packaged ? 'Packaged' : 'Source'} SQLite is not compatible with Electron. Run npm run rebuild:electron before packaging.`)
  process.exit(1)
}
