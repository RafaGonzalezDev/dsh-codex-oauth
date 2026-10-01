import { z } from 'zod';
import type { LlmResolvedModelInfo, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { ModelView } from './contracts.ts';
import { PlanError } from './errors.ts';

export const PROVIDER_ID = 'chatgpt-plan';
export const PREFERRED_MODEL = 'gpt-6.1-sol';

export const CatalogModel = z.object({
  id: z.string().min(1), name: z.string().min(1),
  inputModalities: z.array(z.enum(['text', 'image'])),
  contextWindow: z.number().positive().optional(),
  reasoningEfforts: z.array(z.string().min(1)).optional(),
  defaultReasoningEffort: z.string().optional(),
  available: z.boolean(), warning: z.string().optional(),
});
export type CatalogModel = z.infer<typeof CatalogModel>;

/** Reviewed on 2026-10-01 against the official model page linked in docs/models.md. */
const REVIEWED: Record<string, { inputModalities: Array<'text' | 'image'>; contextWindow: number; reasoningEfforts: string[]; defaultReasoningEffort?: string }> = {
  'gpt-6-sol': { inputModalities: ['text', 'image'], contextWindow: 1_050_000, reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultReasoningEffort: 'medium' },
  'gpt-6-luna': { inputModalities: ['text', 'image'], contextWindow: 1_050_000, reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultReasoningEffort: 'medium' },
  'gpt-6-astra': { inputModalities: ['text', 'image'], contextWindow: 1_050_000, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  'gpt-6.1-sol': { inputModalities: ['text', 'image'], contextWindow: 1_050_000, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultReasoningEffort: 'medium' },
};

const WireModel = z.object({
  slug: z.string().min(1), display_name: z.string().min(1), visibility: z.string(),
  input_modalities: z.array(z.string().min(1)).optional(),
  context_window: z.number().positive().optional(),
  supported_reasoning_levels: z.array(z.union([z.string(), z.object({ effort: z.string(), description: z.string().optional() })])).optional(),
  default_reasoning_level: z.string().optional(),
});

export function parseCatalog(body: unknown): CatalogModel[] {
  const result = z.object({ models: z.array(WireModel) }).safeParse(body);
  if (!result.success) throw new PlanError('INVALID_CATALOG', 'OpenAI returned an unsupported model catalog.');
  const seen = new Set<string>();
  for (const model of result.data.models) {
    if (seen.has(model.slug)) throw new PlanError('INVALID_CATALOG', 'OpenAI returned duplicate model identifiers.');
    seen.add(model.slug);
  }
  const models = result.data.models.filter(model => model.visibility === 'list').map(model => {
    const reviewed = REVIEWED[model.slug];
    const advertisedModalities = model.input_modalities ?? reviewed?.inputModalities ?? [];
    const modalities = advertisedModalities.filter((value): value is 'text' | 'image' => value === 'text' || value === 'image');
    const efforts = model.supported_reasoning_levels?.map(level => typeof level === 'string' ? level : level.effort) ?? reviewed?.reasoningEfforts;
    const defaultEffort = model.default_reasoning_level ?? reviewed?.defaultReasoningEffort;
    const context = model.context_window ?? reviewed?.contextWindow;
    return {
      id: model.slug, name: model.display_name, inputModalities: [...modalities],
      ...(context ? { contextWindow: context } : {}),
      ...(efforts?.length ? { reasoningEfforts: [...new Set(efforts)], ...(defaultEffort && efforts.includes(defaultEffort) ? { defaultReasoningEffort: defaultEffort } : {}) } : {}),
      available: modalities.includes('text'),
      ...(!modalities.includes('text') ? { warning: 'Input capabilities are unavailable. This model is not advertised to the Harness selector.' } : {}),
      ...(modalities.includes('text') && advertisedModalities.some(value => value !== 'text' && value !== 'image') ? { warning: 'Direct audio and video inputs are not supported by this provider. They retain native file handling.' } : {}),
    };
  });
  return models;
}

export function publicModel(model: CatalogModel): ModelView {
  return { id: model.id, name: model.name, available: model.available, inputModalities: [...model.inputModalities], ...(model.warning ? { warning: model.warning } : {}) };
}

export function resolvedModel(model: CatalogModel): LlmResolvedModelInfo {
  if (!model.available) throw new PlanError('UNKNOWN_CAPABILITY', 'This model has no verified input capabilities. Refresh the catalog or update the plugin.');
  return {
    provider: PROVIDER_ID, id: model.id, name: model.name, inputModalities: [...model.inputModalities],
    ...(model.contextWindow ? { context: { contextWindow: model.contextWindow } } : {}),
    ...(model.reasoningEfforts?.length ? {
      reasoning: {
        efforts: model.reasoningEfforts.map(id => ({ id: id as ReasoningEffortId, name: id })),
        ...(model.defaultReasoningEffort ? { defaultEffort: model.defaultReasoningEffort as ReasoningEffortId } : {}),
      },
    } : {}),
    systemPromptUpdate: 'in-history',
  };
}
