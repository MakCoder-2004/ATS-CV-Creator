const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const source = path.join(__dirname, '..', '.env')
let contents
try { contents = fs.readFileSync(source, 'utf8') } catch { console.error('Project Tavily MCP needs an ignored .env with TAVILY_API_KEY.'); process.exit(1) }
const match = contents.split(/\r?\n/).find(line => /^\s*(?:export\s+)?TAVILY_API_KEY\s*=/.test(line))
if (!match) { console.error('Project Tavily MCP key is unavailable.'); process.exit(1) }
const value = match.replace(/^\s*(?:export\s+)?TAVILY_API_KEY\s*=/, '').trim()
const key = value.replace(/^(['"])([\s\S]*)\1$/, (_whole, _quote, body) => body)
if (!/^tvly-[\x21-\x7e]{8,500}$/.test(key)) { console.error('Project Tavily MCP key has an invalid format.'); process.exit(1) }
const npm = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
if (!fs.existsSync(npm)) { console.error('Project Tavily MCP requires the installed Node npm CLI.'); process.exit(1) }
const allowed = ['PATH', 'Path', 'SystemRoot', 'COMSPEC', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'HOME']
const env = Object.fromEntries(allowed.filter(name => process.env[name]).map(name => [name, process.env[name]]))
env.TAVILY_API_KEY = key
env.DEFAULT_PARAMETERS = JSON.stringify({ search_depth: 'basic', max_results: 5, include_answer: false, include_raw_content: false })
const child = spawn(process.execPath, [npm, 'exec', '--yes', '--package=tavily-mcp@0.2.22', '--', 'tavily-mcp'], {
  cwd: path.join(__dirname, '..'), env, stdio: 'inherit', windowsHide: true
})
child.on('error', () => { console.error('Project Tavily MCP could not start.'); process.exitCode = 1 })
child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : code ?? 1 })
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal))
