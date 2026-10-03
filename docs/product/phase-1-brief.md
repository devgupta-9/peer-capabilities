# Original Phase-1 brief (historical planning input)

Preserved verbatim below. Its planning-only restrictions and initial release assumptions describe the original request, not the later implementation authorization. The maintained architecture and ADRs supersede conflicting decisions.

You are acting as the principal systems architect for the existing repository:

https://github.com/devgupta-9/peer-capabilities

This is a PLANNING task only.

DO NOT implement anything.
DO NOT modify files.
DO NOT commit.
DO NOT push.
DO NOT create a release.
DO NOT publish npm packages.

Your job is to inspect the current repository, understand its existing architecture and security properties, then produce a detailed implementation plan for evolving it into Phase 1 of a product called **Peer Capabilities**.

Do not assume the architecture described below already exists. Compare it against the actual repository and clearly distinguish:

- existing capability;
- capability that can be extended;
- capability that must be redesigned;
- entirely new capability.

---

# PRODUCT THESIS

Peer Capabilities should not become another generic multi-agent coding orchestrator.

Its intended position is:

> A provider-independent engineering governance and shared-context layer that allows heterogeneous AI coding agents to plan, implement, challenge, verify, fail over, and collaborate under a reproducible engineering policy.

It should work with one agent, two agents, or many agents.

Two capable agents are the recommended default, but there must be no architectural dependency on exactly two agents.

Examples of possible agents include:

- Codex
- Antigravity
- Claude
- Grok
- Gemini
- OpenCode
- future coding agents

Support should be adapter-based.

Do not hard-code the architecture around Codex + Antigravity even though those are currently the most mature integrations.

---

# USER EXPERIENCE

A user should eventually be able to run:

```bash id="cssvkn"
npx -y @devgupta/peer-capabilities setup
```

and reconstruct the supported local engineering environment without copying credentials.

The local product should eventually manage/reconstruct, where technically and legally possible:

- agent CLIs;
- Peer Capabilities runtime;
- engineering policy;
- master AGENTS/reference material;
- agent-specific instructions;
- orchestrator configuration;
- MCPs;
- skills;
- supported plugins;
- Headroom;
- Graphify;
- Jev;
- agent adapters;
- security policy;
- Git policy;
- context/state infrastructure;
- health verification.

Authentication stays with each provider's official mechanism.

Peer Capabilities must never reproduce private credentials.

---

# CORE ARCHITECTURAL REQUIREMENT: N-AGENT SYSTEM

The system must work with:

```text id="c8dhtr"
1 agent
2 agents
3+ agents
```

If only one capable agent exists, development continues normally with stronger self-verification.

If multiple capable agents exist, Peer Capabilities can dynamically assign:

```text id="vf178j"
lead
reviewer
specialist
consultant
fallback
```

Roles are task-specific rather than permanent.

A user may explicitly request an agent/model/reasoning level in their prompt.

Otherwise Peer Capabilities chooses automatically.

---

# USER EXECUTION MODES

Phase 1 should expose only two simple user-facing modes:

```text id="5rve2p"
FAST
STANDARD
```

FAST should prioritize:

- lower latency;
- fewer consultations;
- smaller context transfers;
- preservation of quotas;
- sufficient rather than maximal redundancy.

STANDARD should prioritize:

- stronger engineering confidence;
- appropriate peer review;
- deeper reasoning for difficult tasks;
- additional specialists only where their expected value justifies the cost.

Do not expose unnecessary model-routing complexity to normal users.

Advanced overrides may exist later.

---

# AGENT SCHEDULER

Peer Capabilities should choose, unless explicitly overridden:

```text id="4fokrj"
lead agent
model
reasoning/thinking effort
reviewers
specialists
consultants
fallback agent
context budget
```

Selection should eventually consider:

```text id="1epx0b"
task type
task complexity
risk
required engineering competence
agent/model capability
availability
authentication state
quota
rate limits
context capacity
latency
subscription/free access
historical local performance
expected usefulness
context-transfer cost
FAST vs STANDARD mode
```

Important principle:

> Do not choose an agent merely because it is free.

A free model must clear the required competence threshold for the assigned role.

Sometimes:

```text id="fpxqkn"
one strong agent
```

is preferable to:

```text id="srlod0"
one strong agent + several weak agents
```

For bounded consultation, prefer the least expensive sufficiently capable agent.

For difficult synthesis, prefer the strongest appropriate available agent.

---

# QUOTA AND AVAILABILITY

Agents should have normalized availability states such as:

```text id="ofcgjk"
AVAILABLE
AVAILABLE_LIMITED
QUOTA_LOW
RATE_LIMITED
QUOTA_EXHAUSTED
AUTH_REQUIRED
MODEL_UNAVAILABLE
SERVICE_UNAVAILABLE
TIMEOUT
CLI_UNAVAILABLE
POLICY_BLOCKED
EXECUTION_ERROR
```

Availability failure is not equivalent to an engineering rejection.

If a peer becomes unavailable:

```text id="vfl11r"
DEGRADED_WITH_CONSULTANT
```

or:

```text id="mni04p"
DEGRADED_SINGLE_AGENT
```

should allow authorized work to continue.

Do not continuously retry exhausted agents during the same work unit.

A recovered agent may rejoin at a later natural checkpoint.

---

# CONSENSUS

When multiple appropriate agents are available, use bounded evidence-driven review.

Example states:

```text id="lkx93p"
APPROVE
REQUEST_CHANGES
BLOCKED
UNAVAILABLE
```

Material objections should cover things such as:

```text id="kcju9x"
correctness
security
requirements
data loss
architecture contracts
important edge cases
test failures
deployment/reliability risks
```

Do not create endless multi-agent debate.

Evidence should resolve disagreement.

Evidence precedence should approximately be:

```text id="t4mp2d"
runtime behavior
tests
current source
schema/config
authoritative documentation
accepted project decisions
durable contextual knowledge
summaries
agent opinion
```

A reviewer should not be able to block indefinitely based on subjective preference.

Human approval remains mandatory for configured high-impact operations such as:

- production deployment;
- destructive database changes;
- irreversible deletion;
- protected branch operations;
- sensitive permission changes;
- other explicitly gated actions.

---

# OPTIONAL CO-CONSULTING

Additional agents may participate as consultants without automatically becoming blocking consensus voters.

For example:

```text id="4p7ym3"
Lead: Codex
Reviewer: Antigravity
Security consultant: Claude
Debugging consultant: Grok
```

Consultants should only be invoked when their expected information gain justifies:

```text id="gyn8bp"
quota
token/context consumption
latency
complexity
```

Avoid agent swarms for their own sake.

---

# UNIFIED CONTEXT FABRIC

This is a core R&D area.

The goal is:

> An agent joining a task at any point can reconstruct a consistent understanding of the current engineering state using the minimum sufficient context.

Unified Context must NOT mean:

```text id="dng87g"
send every agent the entire repository +
entire conversation +
all previous agent outputs +
all logs
```

Instead use:

> one canonical shared state with optimized projections for each agent.

Plan an architecture containing concepts such as:

```text id="83ty0d"
Event Store
Canonical State
Context Broker
Graphify durable knowledge
Headroom context-resource management
Source Evidence
Agent Context Checkpoints
Context Versions
Delta Hydration
```

---

# EVENT-DRIVEN CONTEXT

Meaningful state changes should be representable as structured events.

Examples:

```text id="d002xh"
TASK_CREATED
USER_REQUIREMENT_ADDED

PLAN_PROPOSED
PLAN_REVISED

AGENT_CONSULTED
AGENT_RATE_LIMITED
AGENT_QUOTA_EXHAUSTED
AGENT_REJOINED

REVIEW_FINDING_CREATED
REVIEW_FINDING_RESOLVED

DECISION_PROPOSED
DECISION_ACCEPTED
DECISION_REJECTED

CODE_CHANGED

TEST_RUN
TEST_FAILED
TEST_PASSED

CONSENSUS_REACHED

HUMAN_APPROVAL_REQUESTED
HUMAN_APPROVAL_GRANTED
HUMAN_OVERRIDE

LEAD_CHANGED

TASK_COMPLETED
```

Events should be versioned and auditable.

Investigate whether an append-oriented local event model is appropriate for Phase 1.

Do not unnecessarily design distributed cloud infrastructure yet.

---

# CANONICAL STATE

Maintain a compact projection of the current task state.

Example fields:

```text id="dyv9r7"
objective
phase
status
lead
active agents
accepted decisions
open decisions
open findings
verification status
consensus status
human-gate status
repository version
context version
```

This should remain relatively small.

---

# CONTEXT DELTA / HYDRATION

If an agent previously participated, track what state it last received.

Conceptually:

```text id="bhs3yc"
agent last saw:
event 418
context v17
graph v55
git abc123
```

If current state is later:

```text id="z33lgl"
event 463
context v21
graph v59
git def456
```

do not re-send everything.

Build a minimal delta containing:

```text id="4lj4rf"
new canonical state
relevant events
new durable knowledge
relevant source/diff changes
current question
```

Plan this carefully.

Adapters may differ in support for:

```text id="uf1wto"
persistent sessions
resumption
prompt caching
context caching
tool use
structured output
context windows
```

The Unified Context layer should hide those differences.

---

# CONTEXT BROKER

The Context Broker should determine:

> What is the smallest evidence package this particular agent needs to competently perform this particular role?

Inputs might include:

```text id="25i2a1"
task
agent
model
role
current canonical state
Graphify knowledge
event history
source evidence
context budget
```

Outputs should be role-specific context packages.

Examples:

Security consultant receives:

```text id="4zsypj"
security constraints
relevant architectural decisions
specific source/diff
tests
open disagreement
```

Frontend consultant receives:

```text id="r2dgnz"
component hierarchy
design constraints
relevant code
visual requirements
accessibility requirements
```

Database reviewer receives:

```text id="gsp3tv"
schema
queries
RLS
transactions
migrations
concurrency evidence
```

---

# HEADROOM

Headroom should be treated primarily as the **context-resource manager**.

Its role should include helping manage:

```text id="3lpl9a"
context pressure
context budgets
compaction
duplication
summarization triggers
context usage
token usage
reusable/cached context
```

Headroom should NOT independently decide semantic importance.

For example, it should not autonomously decide:

```text id="k3u8ft"
"this security decision is unimportant"
```

Semantic selection belongs to the Context Broker/governance layer.

Plan exactly how Headroom should integrate with the Context Broker without becoming a single point of failure.

If Headroom fails:

```text id="ylwvuh"
HEADROOM_UNAVAILABLE
```

the system should continue with conservative static context rules.

---

# GRAPHIFY

Graphify should act as the **durable semantic knowledge layer**.

Do not use it as a dump of all agent messages.

Appropriate durable knowledge includes:

```text id="4j5u2m"
architecture relationships
module dependencies
API contracts
database relationships
security invariants
accepted constraints
important resolved engineering decisions
durable failure-mode knowledge
```

Use a lifecycle similar to:

```text id="d5sh09"
raw information
→ event
→ evidence
→ accepted/verified decision
→ durable knowledge
→ Graphify
```

Temporary hypotheses, agent chatter, raw logs and rate-limit events should generally not become Graphify knowledge.

If Graphify becomes unavailable, development must continue using:

```text id="2bx5cu"
canonical state
event history
source retrieval
```

with reduced retrieval efficiency.

---

# JEV

Jev should NOT be treated as another engineering agent.

Treat it as an optional structured decision/routing assistant.

Possible uses:

```text id="jxncg0"
risk classification
escalation decision
whether another consultation is worthwhile
whether a disagreement appears material
whether degraded execution is acceptable
routing assistance
```

It must never override deterministic hard policy.

Example:

```text id="34w13y"
protected main cannot be pushed directly
```

cannot become:

```text id="qzzuhl"
"Jev says 97% safe, bypass policy."
```

If Jev is unavailable:

```text id="esw7ns"
JEV_UNAVAILABLE
```

fall back to deterministic scheduler policy.

Jev must not be a critical dependency.

---

# CONTEXT RETENTION

Plan a local Phase-1 retention lifecycle such as:

```text id="naefiv"
HOT
WARM
COLD
```

HOT:
current task details.

WARM:
recent task summaries, important findings and verification.

COLD:
durable knowledge, ADRs, important audit references, human approvals.

Avoid permanently retaining endless raw agent dialogue.

Compaction should preserve references to important source evidence.

Critical security/human/destructive-operation evidence should not be irreversibly summarized away.

---

# CONTEXT STATES

Plan support for states such as:

```text id="2ynt3p"
ACTIVE
SUPERSEDED
STALE
REJECTED
RESOLVED
ARCHIVED
```

Do not silently erase historical decisions.

Example:

```text id="136hjx"
Redis locking
SUPERSEDED_BY
PostgreSQL advisory locking
```

This prevents inactive agents from resurrecting obsolete decisions.

---

# CONTEXT MISMATCH DETECTION

If an agent operates from stale assumptions, Peer Capabilities should eventually be able to identify a mismatch.

Example:

Agent says:

```text id="d34lfr"
"We should introduce Redis."
```

Unified Context says:

```text id="r05i71"
ADR-14 explicitly rejected Redis.
```

System can respond with a targeted context correction rather than replaying the entire project history.

Plan how this could work without excessive complexity in the first release.

---

# PRIVACY

Context items should eventually support classifications like:

```text id="92hh8c"
PUBLIC
PROJECT
SENSITIVE
SECRET
```

SECRET values should generally never enter Unified Context.

For credentials record only information such as:

```text id="ti9sdk"
credentialPresent = true
```

not:

```text id="pgdcdx"
credentialValue = ...
```

Preserve the repository's existing secret protections and improve them where needed.

---

# TOKEN / CONTEXT OPTIMIZATION

Token optimization is a first-class design requirement.

Plan for:

### Retrieval optimization
Retrieve only relevant files/symbols/diffs/tests.

### Role-specific context
Different agents receive different projections.

### Delta transmission
Do not resend known context.

### Stable-context reuse
Reference/cache architecture and policy where supported.

### Context compaction
Convert long conversations into structured state/decisions.

### Quota preservation
Do not spend high-value agents on trivial work.

### Competence gates
Do not call incapable free agents merely because they cost nothing.

### Stop conditions
When evidence is sufficient and material objections are resolved, stop consulting more agents.

---

# LOCAL PERFORMANCE LEARNING

Phase 1 may locally collect non-secret execution metadata to improve future routing.

Examples:

```text id="4krapb"
agent
model
task category
role
context size
input/output tokens where available
latency
availability failures
material findings
accepted findings
rejected findings
task outcome
```

Do not store raw credentials.

Avoid cloud telemetry in Phase 1.

Plan the schema conservatively so it can evolve.

Do not pretend noisy early statistics are reliable model benchmarks.

---

# SOURCE OF TRUTH

Canonical rule:

> Source truth outranks remembered context.

Repository/runtime/test evidence should be able to invalidate stale Graphify/context knowledge.

Plan contradiction handling.

Example:

```text id="q9ajvk"
Graphify says:
Auth uses Redis sessions.

Repository says:
Auth uses PostgreSQL sessions.
```

Generate a context conflict, verify current evidence, then supersede stale knowledge.

---

# REPRODUCIBILITY

For important consultations, it should eventually be possible to know:

```text id="57yblj"
which agent
which model
which role
which reasoning effort
which context version
which graph version
which repository commit
which task
```

was used.

This does not require recording hidden chain-of-thought.

Do not attempt to persist private reasoning.

Record inputs, structured outcomes and evidence instead.

---

# HUMAN GOVERNANCE

Humans remain above the agent system.

Agent consensus must not automatically authorize configured high-impact operations.

Design explicit human gates.

These gates should be policy driven rather than scattered conditional statements.

---

# CORE FAILURE PRINCIPLE

Optional intelligence components must degrade gracefully.

Critical minimum:

```text id="hnhnyh"
one capable lead agent
repository/source
canonical task state
basic context retrieval
```

Optional/degradable:

```text id="pcezbu"
additional agents
Jev
Graphify
Headroom
performance learning
advanced consensus
```

If optional components fail, capability may degrade but authorized development should not unnecessarily stop.

---

# CURRENT SECURITY ISSUES

Inspect whether these previously identified concerns are still present before planning around them:

1. delegated child processes inheriting broad `process.env`;
2. diagnostic stderr/stdout potentially containing secrets;
3. incomplete Antigravity Git mutation deny validation;
4. release/tag immutability/signing/integrity;
5. secret history scanning;
6. supported Node versions versus CI matrix.

Do not assume they remain unfixed.

Inspect current main and report their actual status.

---

# NPM PRODUCT

Phase 1 eventually becomes an npm-distributed CLI.

Target:

```bash id="pcooxy"
npx -y @devgupta/peer-capabilities setup
```

Possible commands:

```text id="wppz5b"
setup
doctor
update
sync
repair
rollback
uninstall
version
```

Do not implement these now.

Plan how the new architecture should be introduced before npm publication.

Do not use npm postinstall for broad system mutation.

---

# PHASE 2 COMPATIBILITY

Phase 2 may later introduce:

```text id="uz0lmo"
web control plane
GitHub App
repository dashboard
task control
team policy
local-runtime pairing
PR workflows
audit history
```

Do NOT design or implement Phase 2 now.

However, avoid Phase-1 architecture decisions that unnecessarily prevent it.

In particular:

- version events;
- version schemas;
- identify actors/tasks;
- separate local secrets from syncable metadata;
- keep repository operations auditable.

No cloud syncing is required in Phase 1.

---

# COMPETITIVE BOUNDARY

Do not turn this into:

```text id="6oy142"
another generic agent swarm
another proprietary inter-agent protocol
another coding IDE
another model reseller
another hosted inference provider
```

Where appropriate, plan compatibility with existing standards such as MCP and future inter-agent standards rather than reinventing them.

Peer Capabilities' core should remain:

```text id="7q20de"
engineering governance
shared context
capability-aware scheduling
evidence-driven collaboration
graceful degradation
reproducible local environment
Git lifecycle
```

---

# YOUR PLANNING TASK

After inspecting the repository, produce an implementation plan.

Do NOT merely repeat this specification.

Challenge it where appropriate.

Identify contradictions, excessive complexity, or areas that should be deferred from the first release.

The plan should answer:

## 1. Current State

What does the repository already implement?

Map existing modules/scripts to the proposed architecture.

## 2. Gap Analysis

For every major subsystem classify:

```text id="i3ve5a"
KEEP
EXTEND
REFACTOR
NEW
DEFER
```

## 3. Proposed Phase-1 Architecture

Provide the proposed module boundaries and data flows.

Include:

```text id="6pwns1"
Agent Adapter Layer
Agent Capability Registry
Agent Scheduler
Quota/Budget Manager
Unified Context Fabric
Event Store
Canonical State
Context Broker
Headroom integration
Graphify integration
Jev integration
Evidence Engine
Consensus/Review Engine
Human Gate Policy
Git lifecycle
Local metrics/performance store
CLI layer
```

If some of these should be merged or deferred, explain why.

## 4. Unified Context Design

Specify:

- event schema;
- canonical state schema;
- context versions;
- agent checkpoints;
- Graphify promotion rules;
- Headroom responsibility;
- context package shape;
- delta hydration;
- compaction;
- contradiction resolution;
- retention;
- privacy classifications.

Avoid premature distributed-system complexity.

## 5. Agent Adapter Contract

Define the minimum generic adapter interface needed to support heterogeneous agents.

Consider:

```text id="guzf00"
discovery
availability
models
capabilities
reasoning efforts
execution
review
structured responses
session support
context capabilities
quota/failure normalization
```

Do not couple it to one vendor.

## 6. Scheduler Design

Explain how FAST and STANDARD choose:

```text id="4bheiw"
lead
model
reasoning effort
reviewers
consultants
context budget
fallback
```

Start with deterministic rules.

Identify where Jev can optionally improve the scheduler later.

Do not make Jev mandatory.

## 7. Token Optimization

Specify concrete mechanisms and stop conditions.

Avoid vague "use fewer tokens" recommendations.

## 8. Failure Model

Design behavior for:

```text id="fg7sr0"
one agent only
peer quota exhaustion
lead quota exhaustion
Graphify down
Headroom down
Jev down
CLI crash
context corruption
stale knowledge
model unavailable
authentication loss
```

## 9. Security Model

Include:

- environment isolation;
- credential boundaries;
- diagnostics redaction;
- filesystem/repository boundaries;
- human gates;
- package integrity;
- downloaded third-party skill/plugin handling.

## 10. Data Ownership

State exactly what Phase 1 stores locally.

Separate:

```text id="rg97k7"
canonical state
events
knowledge
metrics
cache
logs
credentials
```

Credentials must remain outside Peer Capabilities.

## 11. Migration Strategy

The existing repository works today.

Plan an incremental migration that keeps it usable throughout development.

Avoid a big-bang rewrite.

## 12. Implementation Phases

Break implementation into small reviewable phases.

For each phase include:

```text id="4ww1dt"
goal
files/modules likely affected
dependencies
tests
exit criteria
risk
```

## 13. MVP Boundary

Be aggressive about cutting scope.

Identify what MUST exist before the first npm release and what should wait.

The first release should prove the architecture rather than implement every theoretical feature.

## 14. Testing Strategy

Include unit, integration, failure injection and clean-install testing.

Pay particular attention to:

```text id="g48272"
context correctness
delta hydration
stale-state handling
scheduler determinism
quota fallback
single-agent operation
secret isolation
agent adapter failures
```

## 15. Risks / Open Research Questions

List genuine unresolved technical questions.

Especially challenge the Unified Context concept.

Clearly label:

```text id="h5fjce"
ENGINEERING
versus
R&D
```

Do not pretend uncertain research problems have already been solved.

## 16. Recommended First Implementation Slice

At the end, recommend the smallest vertical slice we should implement first that validates the architecture end-to-end.

It should be something testable, not merely scaffolding.

---

# IMPORTANT

Do not optimize the plan for maximum feature count.

Optimize for:

```text id="6m2byn"
correct architecture
security
incremental delivery
testability
low initial cost
token efficiency
graceful degradation
future extensibility
```

Question assumptions where necessary.

Do not write implementation code.

Return the architecture/implementation plan only.
