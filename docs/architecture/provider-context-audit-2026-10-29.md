# Provider context audit — 2026-10-29

Status: **development audit; live scoped collection remains gated**.

The next resource increment needs a provider-owned context that can be bound to
the actual invocation. An operator label or a successful login check is insufficient.
No login, account change, credential read, model invocation or live configuration
mutation was performed in this audit.

## Inspected interfaces

| Frontend | Local evidence | Finding |
| --- | --- | --- |
| Codex CLI 0.154.0 | `app-server --help`, `login --help`, `exec --help`, and locally generated app-server TypeScript protocol | Account discovery exists. The inspected account response exposes mode and plan/email information, but does not establish an immutable execution identity. No certified context-binding contract was established for the current `codex exec` adapter. |
| Antigravity CLI 1.4.9 | `agy --help` and official CLI reference | The inspected flags expose model, effort, project and conversation choices. They did not establish an account/generation selector that the adapter can pin and independently verify. |

Codex protocol generation wrote public type definitions to a temporary directory;
it did not start an authenticated app-server or request account information.
The inspected types included `Account`, `GetAccountParams`, `GetAccountResponse`,
`ThreadStartParams` and `TurnStartParams`. Runtime account identifiers, email
addresses and credentials were neither collected nor persisted.

The [official app-server authentication documentation](https://learn.chatgpt.com/docs/app-server#auth-endpoints)
describes account status, managed authentication and external-token authentication.
External-token authentication requires caller-supplied credentials; this project
does not adopt it to bypass its provider-owned authentication boundary.

The [official managed authentication configuration](https://learn.chatgpt.com/docs/enterprise/managed-configuration#manage-authentication-locally)
describes login/workspace restrictions. Those restrictions were not changed or
tested against the user's account. A login restriction alone has not been shown
to provide the invocation identity required by the resource contract.

The [official Antigravity CLI reference](https://antigravity.google/docs/cli/reference/)
was checked alongside local help. This bounded audit does not prove that every
provider integration surface lacks the required facility.

## Decision and remaining gate

The engineering conclusion is an inference from the inspected interfaces:
**do not register real scoped collectors yet**. Matching status before and after
a call cannot rule out an intervening account switch and switch-back. A model's
assertion about its account cannot supply the missing proof.

Before live activation, each adapter needs evidence of:

1. A provider-supported way to select and retain the intended execution context.
2. Independent binding between that context and the actual invocation.
3. Role-specific observed checks and bounded child cancellation/reconciliation.
4. Dispatch-time context validation using the same certified mechanism.

Continue failure-feedback integration independently: an ordinary failed task call
can revoke its selected proof without minting new authentication or capability
claims. See the [seventh resource increment](identity-resource-contracts.md#invocation-failure-feedback--seventh-increment-2026-10-29).
