import * as z from 'zod/v4';
import { assertNonSecret } from './security.js';

const need = z.enum(['SOURCE_RELATIONSHIPS', 'LARGE_OUTPUT', 'BOUNDED_DECISION', 'PATCH_REVIEW', 'ARTIFACT_ANALYSIS']);
export const taskToolInputSchema = z.strictObject({
  objective: z.string().min(1).max(24000),
  // Explicit intent replaces the conservative English-language inference, including [].
  needs: z.array(need).max(5).optional(),
  outputBytes: z.number().int().min(0).max(100_000_000).default(0),
  protectedMaterial: z.boolean().default(true),
  evidenceAvailable: z.boolean().default(false),
  artifactInScope: z.boolean().default(false),
});
export const taskToolPlanSchema = z.strictObject({
  version: z.literal(1),
  execution: z.literal('HOST_GATED'),
  verification: z.literal('NOT_PERFORMED'),
  decisions: z.array(z.strictObject({
    integration: z.enum(['graphify', 'headroom', 'jev', 'rea']),
    tool: z.string(), status: z.enum(['SELECTED', 'DEFERRED', 'SKIPPED']),
    reason: z.string(), requires: z.array(z.string()),
  })).length(4),
});
export type TaskToolPlan = z.infer<typeof taskToolPlanSchema>;

/** Pure selection, not permission, discovery, authentication, or tool execution. */
export function selectTaskTools(raw: unknown, enabled: Readonly<Record<string, boolean>> = {}): TaskToolPlan {
  assertNonSecret(raw);
  const input = taskToolInputSchema.parse(raw);
  const needs = new Set(input.needs ?? []);
  if (input.needs === undefined) {
    if (/\b(architecture|dependencies|dependency|call graph|impact analysis|relationships)\b/i.test(input.objective)) needs.add('SOURCE_RELATIONSHIPS');
    if (/\b(trade-?offs?|choose between|compare alternatives|bounded decision)\b/i.test(input.objective)) needs.add('BOUNDED_DECISION');
    if (/\b(review (?:the |this |a )?(?:patch|diff|changes)|verify completion)\b/i.test(input.objective)) needs.add('PATCH_REVIEW');
    if (/\b(reverse.engineer(?:ing)?|decompil(?:e|ation)|binary analysis|shipped artifact)\b/i.test(input.objective)) needs.add('ARTIFACT_ANALYSIS');
    if (input.outputBytes >= 12000) needs.add('LARGE_OUTPUT');
  }
  const rules = [
    { integration: 'graphify' as const, tool: 'query_graph', relevant: needs.has('SOURCE_RELATIONSHIPS'),
      missing: '', reason: 'Source relationships or impact', requires: ['Current graph for the authorized repository; otherwise use source inspection.'] },
    { integration: 'headroom' as const, tool: 'headroom_compress', relevant: needs.has('LARGE_OUTPUT'),
      missing: input.protectedMaterial ? 'Protected or unclassified material must remain exact' : input.outputBytes < 12000 ? 'No measured large eligible output' : '',
      reason: 'Measured large non-critical output', requires: ['Retain originals; retrieve them before consequential decisions.'] },
    { integration: 'jev' as const, tool: needs.has('PATCH_REVIEW') ? 'jev_gate' : 'jev_decide',
      relevant: needs.has('BOUNDED_DECISION') || needs.has('PATCH_REVIEW'),
      missing: input.evidenceAvailable ? '' : 'Supply bounded alternatives or patch/claims and supporting evidence first',
      reason: 'Bounded evidence-based advice', requires: ['Provider authentication, data-sharing and cost permission; advice cannot approve actions or replace tests.'] },
    { integration: 'rea' as const, tool: 'binary_session', relevant: needs.has('ARTIFACT_ANALYSIS'),
      missing: input.artifactInScope ? '' : 'Identify an authorized artifact/runtime target first',
      reason: 'Shipped-artifact or runtime analysis', requires: ['Inspect the scoped target; launching, attaching, network capture or mutations need separate permission.'] },
  ];
  return taskToolPlanSchema.parse({ version: 1, execution: 'HOST_GATED', verification: 'NOT_PERFORMED',
    decisions: rules.map(rule => ({ integration: rule.integration, tool: rule.tool,
      status: enabled[rule.integration] === false || !rule.relevant ? 'SKIPPED' : rule.missing ? 'DEFERRED' : 'SELECTED',
      reason: enabled[rule.integration] === false ? 'Disabled by runtime policy' : !rule.relevant ? 'Not needed for this task' : rule.missing || rule.reason,
      requires: ['Discover this tool in the current host session and respect its existing permissions.', ...rule.requires],
    })),
  });
}
