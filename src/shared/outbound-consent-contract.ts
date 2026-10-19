import { z } from 'zod'

export const outboundConsentPreviewSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), token: z.string().uuid(), jobTitle: z.string(), jobCompany: z.string(), outgoing: z.record(z.string(), z.unknown()), warning: z.string(), termsNotice: z.string() }).strict(),
  z.object({ ok: z.literal(false), message: z.string() }).strict()
])
export type OutboundConsentPreview = z.infer<typeof outboundConsentPreviewSchema>
export const outboundConsentActionSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), runId: z.string().uuid(), message: z.string() }).strict(),
  z.object({ ok: z.literal(false), message: z.string() }).strict()
])
export type OutboundConsentAction = z.infer<typeof outboundConsentActionSchema>
