import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as z from 'zod/v4';

export const effortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export type Effort = z.infer<typeof effortSchema>;
export type ModelChoice = { model: string; effort: Effort; fallback: false };
export type CatalogModel = {
  model: string;
  description: string;
  efforts: string[];
  allowed: boolean;
  restriction?: string;
};

const modelPolicySchema = z.object({
  codex: z.object({
    excludedNameTokens: z.array(z.string().min(1).max(64)).max(100),
    excludedDescriptionPhrases: z.array(z.string().min(1).max(128)).max(100),
    internalNameSubstrings: z.array(z.string().min(1).max(64)).max(100),
  }),
});

export type ModelPolicy = z.infer<typeof modelPolicySchema>;

let cachedPolicy: ModelPolicy | undefined;

export function loadModelPolicy(): ModelPolicy {
  if (cachedPolicy) return cachedPolicy;
  const configured = process.env.PEER_AGENTS_POLICY_FILE?.trim();
  const policyPath = configured
    ? path.resolve(configured)
    : fileURLToPath(new URL('../policy.json', import.meta.url));
  cachedPolicy = modelPolicySchema.parse(JSON.parse(readFileSync(policyPath, 'utf8')));
  return cachedPolicy;
}

export function parseCodexCatalog(value: unknown, policy = loadModelPolicy()): CatalogModel[] {
  const validatedPolicy = modelPolicySchema.parse(policy);
  const catalog = z.object({
    models: z.array(z.object({
      slug: z.string(),
      description: z.string().default(''),
      supported_reasoning_levels: z.array(z.object({ effort: z.string() })),
    })),
  }).parse(value);

  const excludedTokens = new Set(validatedPolicy.codex.excludedNameTokens.map((item) => item.toLowerCase()));
  const excludedDescriptions = validatedPolicy.codex.excludedDescriptionPhrases.map((item) => item.toLowerCase());
  const internalNames = validatedPolicy.codex.internalNameSubstrings.map((item) => item.toLowerCase());

  return catalog.models.map((entry) => {
    const slug = entry.slug.toLowerCase();
    const slugTokens = slug.split(/[^a-z0-9]+/).filter(Boolean);
    const description = entry.description.toLowerCase();
    const lightweight = slugTokens.some((token) => excludedTokens.has(token))
      || excludedDescriptions.some((phrase) => description.includes(phrase));
    const internal = internalNames.some((fragment) => slug.includes(fragment));
    return {
      model: entry.slug,
      description: entry.description,
      efforts: entry.supported_reasoning_levels.map((level) => level.effort),
      allowed: !lightweight && !internal,
      ...(lightweight
        ? { restriction: 'Lightweight Codex models are excluded by configured policy; use Antigravity or direct tools.' }
        : internal
          ? { restriction: 'Internal approval models are not delegated engineering models.' }
          : {}),
    };
  });
}

export function validateChoice(
  target: 'codex' | 'antigravity',
  model: string,
  effort: Effort,
  codexModels: CatalogModel[],
  agyModels: string[],
): ModelChoice {
  if (target === 'codex') {
    const entry = codexModels.find((item) => item.model === model);
    if (!entry) {
      throw new Error('Model is not in the local Codex catalog. Refresh Codex model discovery and select an exact listed model.');
    }
    if (!entry.allowed) throw new Error(entry.restriction);
    if (!entry.efforts.includes(effort)) {
      throw new Error(`Unsupported effort ${effort} for Codex model ${model}.`);
    }
  } else {
    if (!agyModels.includes(model)) {
      throw new Error('Model is not in fresh Antigravity model discovery. Refresh peer_capabilities and select an exact listed model.');
    }
    if (!['low', 'medium', 'high'].includes(effort)) {
      throw new Error(`Antigravity supports low, medium, or high effort; received ${effort}.`);
    }
    const suffix = model.match(/-(low|medium|high)$/i)?.[1]?.toLowerCase();
    if (suffix && suffix !== effort) {
      throw new Error(`Antigravity model suffix ${suffix} and requested effort ${effort} disagree.`);
    }
  }
  return { model, effort, fallback: false };
}
