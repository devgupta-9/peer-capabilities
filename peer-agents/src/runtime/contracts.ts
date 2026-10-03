import * as z from 'zod/v4';

export const availability = z.enum(['AVAILABLE', 'AVAILABLE_LIMITED', 'QUOTA_LOW', 'RATE_LIMITED',
  'QUOTA_EXHAUSTED', 'AUTH_REQUIRED', 'MODEL_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'TIMEOUT',
  'CLI_UNAVAILABLE', 'POLICY_BLOCKED', 'EXECUTION_ERROR']);
export type Availability = z.infer<typeof availability>;
export type Role = 'lead' | 'reviewer' | 'specialist' | 'consultant';
export type Mode = 'FAST' | 'STANDARD';
export type Authentication = 'UNKNOWN' | 'NOT_REQUIRED' | 'AUTH_REQUIRED' | 'AUTHENTICATED';
export type Choice = {
  agent: string; model: string; effort: string; efforts: string[]; roles: Role[];
  competence: number; cost: number; latency: number; contextWindow: number;
  availability: Availability; authentication: Authentication; provider: string; quotaPool: string;
};
export type Observation = {
  component: string; presence: 'DISCOVERED' | 'INSTALLED' | 'CONFIGURED';
  authentication: Authentication; verification: 'UNVERIFIED' | 'VERIFIED' | 'UNAVAILABLE';
  observedAt: string; version?: string; scope?: string; reason?: string; expiresAt?: string;
};
export type Invocation = {
  id: string; taskId: string; cwd: string; role: Role; choice: Choice; prompt: string;
  signal?: AbortSignal;
};
export type AgentResult = {
  availability: Availability; response: string; session?: string;
  review?: { outcome: 'APPROVE' | 'REQUEST_CHANGES' | 'BLOCKED'; findings: string[] };
};
export interface AgentAdapter {
  readonly id: string;
  discover(): Promise<{ observation: Observation; choices: Choice[] }>;
  execute(input: Invocation): Promise<AgentResult>;
  loginInstructions(): string;
}
export type Review = {
  agent?: string; outcome: 'APPROVE' | 'REQUEST_CHANGES' | 'BLOCKED' | 'UNAVAILABLE';
  findings: string[]; reason?: string;
};
export type TestRecord = { phase: string; passed: boolean; command: string[]; evidence: string };
export type TaskState = {
  id: string; objective: string; repository: string; baseline: string; manifestDigest: string;
  environmentDigest: string; revision: number; contextVersion: number;
  status: 'CREATED' | 'RUNNING' | 'CHECKPOINTED' | 'READY' | 'INTEGRATING' | 'COMPLETE' | 'BLOCKED';
  assignment?: Choice; worktree?: string; baseSha?: string; leadFinished: boolean;
  tests: TestRecord[]; reviews: Review[]; notes: string[]; degraded: boolean;
  checkpoint?: Record<string, unknown>;
  patch?: { path: string; hash: string; bytes: number };
  integration?: { operationDigest: string; actor: string; integrated: boolean;
    approvalId?: string; issuer?: string; issuedAt?: number; expiresAt?: number };
};
