import { z } from 'zod';
import type { LlmResolvedModelInfo, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { ModelView } from './contracts.ts';
import { PlanError } from './errors.ts';

export const PROVIDER_ID = 'chatgpt-plan';
export const PREFERRED_MODEL = 'gpt-6.1-sol';
export const PI_CATALOG_URL = 'https://pi.dev/api/models/providers/openai-codex?types=chat';
export const PI_CATALOG_PROVIDER = 'openai-codex';
export const PI_CATALOG_MAX_MODELS = 1000;
export const PI_CATALOG_MAX_BYTES = 2 * 1024 * 1024;

const Identifier = z.string().max(256).refine(value => value.trim().length > 0);
const ReasoningEffort = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const ThinkingMapValue = Identifier.nullable().optional();

export const CatalogModel = z.object({
  id: Identifier, name: Identifier,
  inputModalities: z.array(z.enum(['text', 'image'])).max(2),
  contextWindow: z.number().int().positive().optional(),
  reasoningEfforts: z.array(ReasoningEffort).max(7).optional(),
  defaultReasoningEffort: ReasoningEffort.optional(),
  available: z.boolean(), warning: z.string().min(1).optional(),
}).strict().refine(model =>
  new Set(model.inputModalities).size === model.inputModalities.length
  && (!model.available || model.inputModalities.includes('text'))
  && (!model.reasoningEfforts || new Set(model.reasoningEfforts).size === model.reasoningEfforts.length)
  && (!model.defaultReasoningEffort || model.reasoningEfforts?.includes(model.defaultReasoningEffort)),
);
export type CatalogModel = z.infer<typeof CatalogModel>;

function uniqueIdentities(models: Array<{ id: string }>): boolean {
  return new Set(models.map(model => model.id)).size === models.length;
}

export const CatalogModels = z.array(CatalogModel).max(PI_CATALOG_MAX_MODELS).refine(uniqueIdentities);

/** Only these Pi metadata fields may cross into the provider catalog or snapshot. */
export const PiCatalogBody = z.array(z.object({
  id: Identifier,
  name: Identifier,
  provider: z.literal(PI_CATALOG_PROVIDER),
  type: z.literal('chat'),
  input: z.array(Identifier),
  contextWindow: z.number().int().positive().optional(),
  reasoning: z.boolean(),
  thinkingLevelMap: z.object({
    off: ThinkingMapValue,
    minimal: ThinkingMapValue,
    low: ThinkingMapValue,
    medium: ThinkingMapValue,
    high: ThinkingMapValue,
    xhigh: ThinkingMapValue,
    max: ThinkingMapValue,
  }).optional(),
})).max(PI_CATALOG_MAX_MODELS).refine(uniqueIdentities);

export function parsePiCatalog(body: unknown): CatalogModel[] {
  const result = PiCatalogBody.safeParse(body);
  if (!result.success) throw new PlanError('INVALID_CATALOG', 'Pi returned an invalid model catalog.');
  return result.data.map(model => {
    const inputModalities = [...new Set(model.input.filter((value): value is 'text' | 'image' => value === 'text' || value === 'image'))];
    const unsupportedInput = model.input.some(value => value !== 'text' && value !== 'image');
    const available = inputModalities.includes('text');
    const efforts: Array<z.infer<typeof ReasoningEffort>> = [];
    if (model.reasoning) {
      // Pi's standard levels are opt-out; xhigh and max are strictly opt-in.
      for (const level of THINKING_LEVELS) {
        const mapped = model.thinkingLevelMap?.[level];
        if (mapped === null || ((level === 'xhigh' || level === 'max') && mapped === undefined)) continue;
        const effort = ReasoningEffort.safeParse(mapped ?? (level === 'off' ? 'none' : level));
        if (effort.success && !efforts.includes(effort.data)) efforts.push(effort.data);
      }
    }
    return {
      id: model.id, name: model.name, inputModalities,
      ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
      ...(efforts.length ? { reasoningEfforts: efforts } : {}),
      available,
      ...(!available ? { warning: 'This model does not advertise text input and is not selectable.' }
        : unsupportedInput ? { warning: 'Unsupported input modalities are omitted. Only text and image inputs are supported by this provider.' } : {}),
    };
  });
}

export function publicModel(model: CatalogModel): ModelView {
  return { id: model.id, name: model.name, available: model.available, inputModalities: [...model.inputModalities], ...(model.warning ? { warning: model.warning } : {}) };
}

export function resolvedModel(model: CatalogModel): LlmResolvedModelInfo {
  if (!model.available) throw new PlanError('UNKNOWN_CAPABILITY', 'This model has unsupported input capabilities. Refresh the catalog or update the plugin.');
  return {
    provider: PROVIDER_ID, id: model.id, name: model.name, inputModalities: [...model.inputModalities],
    ...(model.contextWindow !== undefined ? { context: { contextWindow: model.contextWindow } } : {}),
    ...(model.reasoningEfforts?.length ? {
      reasoning: {
        efforts: model.reasoningEfforts.map(id => ({ id: id as ReasoningEffortId, name: id })),
        ...(model.defaultReasoningEffort ? { defaultEffort: model.defaultReasoningEffort as ReasoningEffortId } : {}),
      },
    } : {}),
    systemPromptUpdate: 'in-history',
  };
}
