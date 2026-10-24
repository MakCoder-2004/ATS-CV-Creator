import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import type { Api, Model } from "@earendil-works/pi-ai"
import { freezePiModelSelection } from "../src/shared/pi-model"
import { createPiDispatcher, PiDispatchError } from "../src/main/pi-dispatcher"
import type { PiModelRuntime } from "../src/main/pi-model"

const model = { id: "model", name: "Synthetic", api: "synthetic" as Api, provider: "provider", baseUrl: "https://example.invalid", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: true, contextWindow: 8192, maxTokens: 1024 } as Model<Api>
const selection = freezePiModelSelection(model.provider, model.id, "low")
const result = (text = '{"ok":true}', overrides: Record<string, unknown> = {}) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", usage: { output: 2 }, ...overrides })
function setup(complete = vi.fn(async () => result())) {
  const runtime = { getPhysicalModel: () => model, getAvailable: async () => [model], getAuth: async () => ({ source: "test" }), completeSimple: complete } as unknown as PiModelRuntime
  const hooks = { onAttempt: vi.fn(), onAttemptComplete: vi.fn() }
  const dispatcher = createPiDispatcher(runtime, hooks)
  const input = (overrides: Record<string, unknown> = {}) => ({ runId: "run", consentId: "consent", jobId: "job", selection, prompt: "authorized prompt", responseSchema: z.object({ ok: z.boolean() }), maxOutputTokens: 32, maxResponseBytes: 100, ...overrides })
  return { dispatcher, runtime, hooks, complete, input }
}

describe("Pi dispatcher", () => {
  it("rejects absent or stale authorization before dispatch", async () => {
    const s = setup()
    await expect(s.dispatcher.dispatch(s.input())).rejects.toMatchObject({ attempts: 0 })
    s.dispatcher.authorize("run", "new-consent")
    await expect(s.dispatcher.dispatch(s.input())).rejects.toMatchObject({ attempts: 0 })
    expect(s.complete).not.toHaveBeenCalled()
  })
  it("does not record an attempt when the selected model has no local authentication", async () => {
    const s = setup(); s.dispatcher.authorize("run", "consent")
    vi.spyOn(s.runtime, "getAvailable").mockResolvedValue([])
    await expect(s.dispatcher.dispatch(s.input())).rejects.toMatchObject({ attempts: 0 })
    expect(s.hooks.onAttempt).not.toHaveBeenCalled()
    expect(s.hooks.onAttemptComplete).not.toHaveBeenCalled()
    expect(s.complete).not.toHaveBeenCalled()
  })
  it("parses valid response and accounts for exactly one physical attempt", async () => {
    const s = setup(); s.dispatcher.authorize("run", "consent")
    await expect(s.dispatcher.dispatch(s.input())).resolves.toMatchObject({ response: { ok: true }, attempts: 1 })
    expect(s.hooks.onAttempt).toHaveBeenCalledTimes(1)
    expect(s.hooks.onAttemptComplete).toHaveBeenCalledWith("run", true)
  })
  it("does not dispatch cancellation while queued", async () => {
    const hold = deferred<void>()
    const first = setup(vi.fn(async () => { await hold.promise; return result() })); first.dispatcher.authorize("run", "consent")
    const firstCall = first.dispatcher.dispatch(first.input())
    await vi.waitFor(() => expect(first.complete).toHaveBeenCalled())
    first.dispatcher.authorize("queued", "c2")
    const queued = first.dispatcher.dispatch(first.input({ runId: "queued", consentId: "c2" }))
    first.dispatcher.cancel("queued")
    hold.resolve()
    await expect(queued).rejects.toMatchObject({ attempts: 0 })
    await firstCall
    expect(first.complete).toHaveBeenCalledTimes(1)
  })
  it("aborts an in-flight request and suppresses late result", async () => {
    const pending = deferred<any>(), s = setup(vi.fn(async () => pending.promise)); s.dispatcher.authorize("run", "consent")
    const controller = new AbortController()
    const request = s.dispatcher.dispatch(s.input({ signal: controller.signal }))
    await vi.waitFor(() => expect(s.complete).toHaveBeenCalled())
    controller.abort(); pending.resolve(result())
    await expect(request).rejects.toMatchObject({ attempts: 1 })
    expect(s.hooks.onAttemptComplete).toHaveBeenCalledWith("run", false)
  })
  it("fails oversized, malformed and truncated responses without success", async () => {
    for (const response of [result('{"ok":true}'), result("not json"), result('{"ok":true}', { stopReason: "length" })]) {
      const s = setup(vi.fn(async () => response)); s.dispatcher.authorize("run", "consent")
      const maxResponseBytes = response.stopReason === "stop" && response.content[0].text.startsWith("{") ? 4 : 100
      await expect(s.dispatcher.dispatch(s.input({ maxResponseBytes }))).rejects.toBeInstanceOf(PiDispatchError)
      expect(s.hooks.onAttemptComplete).toHaveBeenCalledWith("run", response.stopReason === "stop")
      expect(s.hooks.onAttempt).toHaveBeenCalledTimes(1)
    }
    const malformed = setup(vi.fn(async () => result('{"ok":"wrong"}'))); malformed.dispatcher.authorize("run", "consent")
    await expect(malformed.dispatcher.dispatch(malformed.input())).rejects.toMatchObject({ attempts: 1 })
  })
  it("serializes physical calls without quotas or pacing", async () => {
    const gate = deferred<void>(), order: string[] = []
    const s = setup(vi.fn(async () => { order.push("start"); await gate.promise; order.push("end"); return result() }))
    s.dispatcher.authorize("one", "c1"); s.dispatcher.authorize("two", "c2")
    const a = s.dispatcher.dispatch(s.input({ runId: "one", consentId: "c1" }))
    const b = s.dispatcher.dispatch(s.input({ runId: "two", consentId: "c2" }))
    await vi.waitFor(() => expect(order).toEqual(["start"]))
    gate.resolve(); await Promise.all([a, b])
    expect(order).toEqual(["start", "end", "start", "end"])
    expect(s.complete).toHaveBeenCalledTimes(2)
  })
})
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
