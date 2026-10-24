import { z } from 'zod'

/** OpenRouter model IDs are provider/model with optional routing suffix (e.g. :free). */
export const openRouterModelSchema = z.string().trim().min(3, 'Enter an OpenRouter model ID.').max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:-]*$/, 'Use an OpenRouter model ID such as xingchen-agi/xing4.0-29b-a4b:free.')
export type OpenRouterModel = z.infer<typeof openRouterModelSchema>
export const defaultOpenRouterModel = 'xingchen-agi/xing4.0-29b-a4b:free'
