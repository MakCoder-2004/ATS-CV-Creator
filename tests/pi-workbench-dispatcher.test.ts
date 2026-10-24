import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import type { Api, Model } from "@earendil-works/pi-ai"
import { freezePiModelSelection } from "../src/shared/pi-model"
import { createPiWorkbenchDispatcher } from "../src/main/pi-workbench-dispatcher"
import type { PiModelRuntime } from "../src/main/pi-model"

const model = { id: "model", name: "Synthetic", api: "synthetic" as Api, provider: "provider", baseUrl: "https://example.invalid", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: true, contextWindow: 8192, maxTokens: 4096 } as Model<Api>
const selection = freezePiModelSelection(model.provider, model.id, "low")
const analysis = { required: [], preferred: [], tools: [], responsibilities: [], keywords: [] }
const result = (text = '{"ok":true}', overrides: Record<string, unknown> = {}) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", usage: { output: 2 }, ...overrides })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function setup(complete = vi.fn(async () => result()), selectionForRun: (runId: string) => typeof selection | null = () => selection) {
  const runtime = { getPhysicalModel: () => model, getAvailable: async () => [model], getAuth: async () => ({ source: "test" }), completeSimple: complete } as unknown as PiModelRuntime
  const hooks = { onAttempt: vi.fn(), onAttemptComplete: vi.fn(), onProgress: vi.fn() }
  const dispatcher = createPiWorkbenchDispatcher({ runtime: Promise.resolve(runtime), selectionForRun, ...hooks })
  const input = (overrides: Record<string, unknown> = {}) => ({ runId: "run", consentId: "consent", jobId: "job", prompt: "authorized synthetic prompt", responseSchema: z.object({ ok: z.boolean() }), ...overrides })
  return { dispatcher, runtime, hooks, complete, input }
}

describe("Pi workbench dispatcher adapter", () => {
  it("requires the matching consent and frozen per-run selection before an attempt", async () => {
    const s = setup()
    await expect(s.dispatcher.analyze(s.input() as any)).rejects.toMatchObject({ usage: { attempts: 0 } })
    s.dispatcher.authorize("run", "consent")
    const missing = setup(undefined, () => null)
    missing.dispatcher.authorize("run", "consent")
    await expect(missing.dispatcher.analyze(missing.input() as any)).rejects.toMatchObject({ usage: { attempts: 0 } })
    expect(missing.hooks.onAttempt).not.toHaveBeenCalled()
    expect(missing.complete).not.toHaveBeenCalled()
  })

  it("uses posting analysis schema and fixed finite analysis output limit", async () => {
    let supplied!: { systemPrompt?: string; messages: Array<{ content: string }> }
    const complete = vi.fn(async (_model: Model<Api>, context: typeof supplied, options: { maxTokens: number }) => {
      supplied = context
      expect(options.maxTokens).toBe(4096)
      return result(JSON.stringify(analysis))
    })
    const s = setup(complete)
    s.dispatcher.authorize("run", "consent")
    await expect(s.dispatcher.analyze(s.input() as any)).resolves.toMatchObject({ analysis, usage: { attempts: 1, status: "complete" } })
    expect(supplied.systemPrompt).toContain('"required"')
    expect(supplied.systemPrompt).toContain('"responsibilities"')
    expect(supplied.systemPrompt).not.toContain('authorized synthetic prompt')
    expect(supplied.messages[0].content).toBe('authorized synthetic prompt')
    expect(s.hooks.onAttempt).toHaveBeenCalledTimes(1)
    expect(s.hooks.onAttemptComplete).toHaveBeenCalledWith("run", true)
  })

  it("preflights authentication and incompatible effort without recording an attempt", async () => {
    const s = setup()
    s.dispatcher.authorize("run", "consent")
    vi.spyOn(s.runtime, "getAvailable").mockResolvedValue([])
    await expect(s.dispatcher.generate(s.input())).rejects.toMatchObject({ usage: { attempts: 0 } })
    expect(s.hooks.onAttempt).not.toHaveBeenCalled()
    const effort = setup()
    effort.dispatcher.authorize("run", "consent")
    vi.spyOn(effort.runtime, "getPhysicalModel").mockReturnValue({ ...model, reasoning: false } as Model<Api>)
    await expect(effort.dispatcher.generate(effort.input())).rejects.toMatchObject({ usage: { attempts: 0 } })
    expect(effort.hooks.onAttempt).not.toHaveBeenCalled()
  })

  it("returns parsed JSON text and one attempt without retries", async () => {
    const complete = vi.fn(async () => result('{"ok":true}'))
    const s = setup(complete)
    s.dispatcher.authorize("run", "consent")
    await expect(s.dispatcher.generate(s.input())).resolves.toEqual({ text: '{"ok":true}', attempts: 1 })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(s.hooks.onAttemptComplete).toHaveBeenCalledWith("run", true)
  })

  it("cancels queued work and discards late responses", async () => {
    const hold = deferred<void>()
    const first = setup(vi.fn(async () => { await hold.promise; return result() }))
    first.dispatcher.authorize("first", "c1")
    first.dispatcher.authorize("queued", "c2")
    const a = first.dispatcher.generate(first.input({ runId: "first", consentId: "c1" }))
    await vi.waitFor(() => expect(first.complete).toHaveBeenCalledTimes(1))
    const b = first.dispatcher.generate(first.input({ runId: "queued", consentId: "c2" }))
    first.dispatcher.cancel("queued")
    hold.resolve()
    await a
    await expect(b).rejects.toMatchObject({ usage: { attempts: 0 } })
    expect(first.complete).toHaveBeenCalledTimes(1)

    const pending = deferred<any>()
    const late = setup(vi.fn(async () => pending.promise))
    late.dispatcher.authorize("run", "consent")
    const request = late.dispatcher.generate(late.input())
    await vi.waitFor(() => expect(late.complete).toHaveBeenCalled())
    late.dispatcher.cancel("run")
    pending.resolve(result())
    await expect(request).rejects.toMatchObject({ usage: { attempts: 1 } })
    expect(late.hooks.onAttemptComplete).toHaveBeenCalledWith("run", true)
  })

  it("rejects oversized or malformed output after recording the physical attempt", async () => {
    for (const body of ['{"ok":true}', "not-json"]) {
      const s = setup(vi.fn(async () => result(body)))
      s.dispatcher.authorize("run", "consent")
      await expect(s.dispatcher.generate(s.input({ maxResponseChars: body.startsWith("{") ? 4 : 100 }))).rejects.toMatchObject({ code: body.startsWith('{') ? 'PROVIDER' : 'MALFORMED', usage: { attempts: 1 } })
      expect(s.hooks.onAttempt).toHaveBeenCalledTimes(1)
      expect(s.hooks.onAttemptComplete).toHaveBeenCalledWith("run", true)
    }
  })
})
