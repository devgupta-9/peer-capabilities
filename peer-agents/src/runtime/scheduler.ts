import type { Choice, Role } from './contracts.js';

export function selectAgent(choices: Choice[], request: {
  role: Role; competence: number; complexity: 'low' | 'medium' | 'high'; requiredContext: number;
  excluded?: string[]; exact?: { agent: string; model: string; effort: string };
}): Choice {
  const eligible = choices.filter(c =>
    c.roles.includes(request.role) && c.competence >= request.competence &&
    c.contextWindow >= request.requiredContext && c.efforts.includes(c.effort) &&
    ['AUTHENTICATED', 'NOT_REQUIRED'].includes(c.authentication) &&
    ['AVAILABLE', 'AVAILABLE_LIMITED', 'QUOTA_LOW'].includes(c.availability) &&
    !request.excluded?.includes(c.agent) &&
    (!request.exact || c.agent === request.exact.agent && c.model === request.exact.model && c.efforts.includes(request.exact.effort)));
  if (!eligible.length) throw new Error('No eligible agent/model/effort; no implicit fallback');
  eligible.sort((a, b) => {
    const rank = request.role === 'lead' && request.complexity === 'high'
      ? b.competence - a.competence || a.cost - b.cost : a.cost - b.cost || b.competence - a.competence;
    return rank || a.latency - b.latency || (a.agent + '/' + a.model).localeCompare(b.agent + '/' + b.model, 'en');
  });
  const selected = { ...eligible[0] };
  if (request.exact) selected.effort = request.exact.effort;
  return selected;
}
