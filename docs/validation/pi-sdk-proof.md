# Installed Pi SDK proof for issue #65

The 0.3.0 installer built from this commit includes pinned `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` 1.4.0 dependencies. The package licenses are MIT; Pi's Photon dependency is Apache-2.0. Review the full new dependency notice inventory before a public release. The installer passed the repository's packaged SQLite and LaTeX checks with physical `node_modules`.

## Choice and boundary

Use `ModelRuntime.completeSimple()` in Electron main for one structured response per authorized request. The installed proof calls it with an explicit model, thinking level, abort signal, maximum output, and `{ tools: [] }`. It creates no agent session, tools, resource loader, extension discovery, context-file discovery, or persisted conversation. An isolated `createAgentSession()` can also avoid those resources, but it adds a session lifecycle and more ways to load configuration for a single-turn task. Both independent design sketches favored the direct runtime as the smaller production interface; neither sketch was evidence of working authentication.

The future main-process request input is a frozen `{ providerId, modelId, thinkingLevel, prompt, signal, maxOutputTokens }`. Keep the provider and model as separate IDs. Resolve a Settings reference against `runtime.getProviders()` and `runtime.getPhysicalModel(providerId, modelId)`. `getRegisteredProviderIds()` lists custom registrations, not built-in providers, and failed to find `openai-codex` in the installed proof. Reject zero or multiple matching provider/model pairs. Check `getSupportedThinkingLevels(model)`, `getAvailable(providerId)`, and `getAuth(model)` before calling `completeSimple()`. These local checks do not establish that an OAuth token remains accepted by the provider. No renderer IPC carries provider credentials or Pi runtime objects.

A result is usable only when `stopReason` is `stop`, content is nonempty text with no tool call, the response fits the task's finite byte limit, and the existing task-specific Zod schema accepts it. Treat `error`, `aborted`, and output-limit stops as failures. Do not silently retry a potentially charged request. Leave consent and physical-attempt recording in the existing workbench owner, not in the SDK adapter.

## Installed observations

The installer ran with `/S`, returned exit code 0, and put `CV Tailor.exe` under the current user's Programs directory. Both scripts below launched that installed executable with isolated user data. Playwright's `electronApplication.evaluate()` executed in its main process. The scripts loaded Pi dependencies from the installed `app.asar` and sent no private CV data.

```bash
node scripts/prove-pi-sdk-in-installed.cjs "<installed CV Tailor.exe>" openai-codex/gpt-6-luna low
node scripts/prove-pi-sdk-in-installed.cjs "<installed CV Tailor.exe>" unknown/chat low invalid-model
node scripts/prove-pi-sdk-in-installed.cjs "<installed CV Tailor.exe>" openai-codex/gpt-6-luna invalid unsupported-effort
node scripts/prove-pi-sdk-in-installed.cjs "<installed CV Tailor.exe>" openai-codex/gpt-6-luna low missing-local-auth --no-auth
node scripts/prove-pi-sdk-cancel.cjs "<installed CV Tailor.exe>"
```

The explicitly authorized harmless live request returned `stop`, provider `openai-codex`, model `gpt-6-luna`, the requested word, and zero tool calls. The installed GUI process found the existing Pi OAuth login. The three negative probes returned `invalid-model`, `unsupported-effort`, and `missing-local-auth` without calling `completeSimple()`. The no-auth probe used an empty synthetic auth file and removed relevant inherited auth variables only from its test process. It did not read or change the person's stored Pi credential.

The cancellation probe used a synthetic provider ID and model ID that both contain `/`, a local HTTP server, and a synthetic key. It observed one request with `model: author/chat`, a 32-token maximum, no tool declaration, and `aborted` after the signal fired. Pi also reserves 4,096 context tokens internally. A deliberately undersized 4,096-token synthetic context reduced the requested 32-token ceiling to one token; the corrected 16,384-token fixture preserved 32. This observation is why the production boundary must reject invalid selections and report provider context failures rather than promising arbitrary input sizes.

The installed script is an explicit test command, not a CV workflow. Posting analysis, generation, profile import, consent, recovery, and key deletion still use the old code until issues #66 through #71. This proof cannot establish that arbitrary future Pi providers authenticate or that a configured but expired login succeeds. The integrated release needs the three live CV workflows and reopen checks.
