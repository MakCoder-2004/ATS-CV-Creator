import { describe, expect, it, vi } from "vitest"
import type { Api, Model } from "@earendil-works/pi-ai"
import { freezePiModelSelection, parsePiModelReference } from "../src/shared/pi-model"
import { completePiTask, type PiModelRuntime } from "../src/main/pi-model"

const model = {
  id: "author/chat/model", name: "Synthetic", api: "synthetic" as Api, provider: "provider/with/slash",
  baseUrl: "https://example.invalid", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  reasoning: true, contextWindow: 8192, maxTokens: 1024,
} as Model<Api>
const selection = freezePiModelSelection(model.provider, model.id, "low")
const reply = (overrides: Record<string, unknown> = {}) => ({
  role: "assistant", content: [{ type: "text", text: "Done." }], stopReason: "stop", usage: { output: 2 }, ...overrides,
})
function runtime(options: { auth?: boolean; available?: boolean; result?: any; error?: boolean } = {}): PiModelRuntime {
  return {
    getProviders: () => [],
    getPhysicalModel: (providerId: string, modelId: string) => providerId === model.provider && modelId === model.id ? model : undefined,
    getAvailable: async () => options.available === false ? [] : [model],
    getAuth: async () => options.auth === false ? undefined : ({ source: "test" } as any),
    completeSimple: options.error ? vi.fn(async () => { throw new Error("private provider detail") }) : vi.fn(async () => options.result ?? reply()),
  } as unknown as PiModelRuntime
}
const request = (overrides: Record<string, unknown> = {}) => ({ selection, prompt: "Authorized prompt", signal: new AbortController().signal, maxOutputTokens: 30, ...overrides })

describe("Pi model request boundary", () => {
  it("parses slash-containing provider and model ids exactly", () => {
    expect(parsePiModelReference("provider/with/slash/author/chat/model", [selection])).toEqual({ providerId: model.provider, modelId: model.id })
  })
  it("rejects missing and ambiguous references", () => {
    expect(() => parsePiModelReference("missing/model", [selection])).toThrow(/Choose a model/)
    expect(() => parsePiModelReference("provider/with/slash/author/chat/model", [selection, selection])).toThrow(/ambiguous/)
  })
  it("returns successful text with retries disabled", async () => {
    const sdk = runtime()
    expect(await completePiTask(sdk, request())).toBe("Done.")
    expect(sdk.completeSimple).toHaveBeenCalledWith(model, expect.objectContaining({ tools: [] }), expect.objectContaining({ maxRetries: 0, maxTokens: 30 }))
  })
  it("rejects missing auth and unavailable models without dispatch", async () => {
    for (const sdk of [runtime({ auth: false }), runtime({ available: false })]) {
      await expect(completePiTask(sdk, request())).rejects.toThrow(/authentication/)
      expect(sdk.completeSimple).not.toHaveBeenCalled()
    }
    await expect(completePiTask(runtime(), request({ selection: freezePiModelSelection("unknown", "missing", "low") }))).rejects.toThrow(/unavailable/)
  })
  it("rejects unsupported effort", async () => {
    await expect(completePiTask(runtime(), request({ selection: freezePiModelSelection(model.provider, model.id, "max") }))).rejects.toThrow(/does not support/)
  })
  it("rejects aborts, provider errors, tool calls, truncation, oversized and empty output", async () => {
    const controller = new AbortController(); controller.abort()
    await expect(completePiTask(runtime(), request({ signal: controller.signal }))).rejects.toThrow(/cancelled/)
    await expect(completePiTask(runtime({ error: true }), request())).rejects.toThrow(/could not complete/)
    await expect(completePiTask(runtime({ result: reply({ stopReason: "toolUse", content: [{ type: "toolCall", name: "x" }] }) }), request())).rejects.toThrow(/tool call/)
    await expect(completePiTask(runtime({ result: reply({ stopReason: "length" }) }), request())).rejects.toThrow(/output limit/)
    await expect(completePiTask(runtime({ result: reply({ usage: { output: 31 } }) }), request())).rejects.toThrow(/output limit/)
    await expect(completePiTask(runtime({ result: reply({ content: [] }) }), request())).rejects.toThrow(/no text/)
    await expect(completePiTask(runtime({ result: reply({ content: [{ type: "text", text: "x".repeat(2000) }] }) }), request())).rejects.toThrow(/large/)
  })
})
