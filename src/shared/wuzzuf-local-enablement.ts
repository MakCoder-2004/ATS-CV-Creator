import { z } from 'zod'

/** This manual local file is intentionally not part of workspace records or backups. */
export const wuzzufPersonalLocalPolicySchema = z.object({
  version: z.literal(1),
  wuzzufPersonalLocalEnabled: z.literal(true),
  acknowledgedNoticeVersion: z.literal(1),
}).strict()

export function parseWuzzufPersonalLocalPolicy(value: unknown): boolean {
  return wuzzufPersonalLocalPolicySchema.safeParse(value).success
}
