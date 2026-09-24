import * as z from 'zod/v4';

export const effortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export type Effort = z.infer<typeof effortSchema>;
export type ModelChoice = { model: string; effort: Effort; fallback: false };
export type CatalogModel = { model: string; description: string; efforts: string[]; allowed: boolean; restriction?: string };

export function parseCodexCatalog(value: unknown): CatalogModel[] {
  const catalog = z.object({ models: z.array(z.object({
    slug: z.string(),
    description: z.string().default(''),
    supported_reasoning_levels: z.array(z.object({ effort: z.string() })),
  })) }).parse(value);
  return catalog.models.map(entry => {
    const lightweight = /(?:^|[-_])(mini|nano|spark|luna|reserve)(?:$|[-_])/i.test(entry.slug)
      || /fast and affordable|lightweight|cost.optimized/i.test(entry.description);
    const internal = /auto-review/i.test(entry.slug);
    return {
      model: entry.slug, description: entry.description,
      efforts: entry.supported_reasoning_levels.map(level => level.effort),
      allowed: !lightweight && !internal,
      ...(lightweight ? { restriction: 'Lightweight Codex models are excluded by user policy; use Antigravity or direct tools.' }
        : internal ? { restriction: 'Internal approval model is not a delegated engineering model.' } : {}),
    };
  });
}

export function validateChoice(target: 'codex' | 'antigravity', model: string, effort: Effort,
  codexModels: CatalogModel[], agyModels: string[]): ModelChoice {
  if (target === 'codex') {
    const entry = codexModels.find(item => item.model === model);
    if (!entry) throw new Error('Model not in the local Codex catalog. Refresh Codex model discovery and select an exact listed model.');
    if (!entry.allowed) throw new Error(entry.restriction);
    if (!entry.efforts.includes(effort)) throw new Error(`Unsupported reasoning effort for ${model}: ${effort}.`);
  } else {
    if (!agyModels.includes(model)) throw new Error('Model not in agy models. Select an exact available model.');
    if (!['low', 'medium', 'high'].includes(effort)) throw new Error('Antigravity supports low, medium, or high effort.');
    const suffix = model.match(/-(low|medium|high)$/i)?.[1]?.toLowerCase();
    if (suffix && suffix !== effort) throw new Error(`Model suffix and effort disagree: ${model} requires ${suffix}.`);
  }
  return { model, effort, fallback: false };
}
