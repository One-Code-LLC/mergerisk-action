# Decision record: commercial entitlements

- **Status:** Proposed product decision; repository foundation implemented
- **Date:** 2026-07-21
- **Scope:** GitHub organization entitlements for future paid MergeRisk features

## Decision

Keep the current Action and its existing feature set as the MIT-licensed
**Community** product. Build paid value as separately operated, proprietary
services and features, with entitlements owned by an immutable GitHub
organization ID. Do not market the public Action's local check as a hard license
boundary: every hosted premium API must independently enforce the entitlement.

The Action therefore defaults to `entitlement-mode: community`, makes no
licensing request in that mode, and preserves all current behavior. An explicit
`entitlement-mode: commercial` performs a preflight check for future commercial
features. This foundation does not itself introduce a paid feature or a billable
plan.

## Licensing strategy

Use an **open-core/service-separation strategy**, not a nominal dual license of
the same code.

The existing MIT grant allows anyone who received the code to use, copy, modify,
distribute, sublicense, and sell it, subject to preserving the notice. That grant
cannot be retroactively withdrawn from existing copies. Offering the same code
under a second commercial license would add little leverage because users can
already choose MIT. Contributions accepted under the current repository license
also need to be treated as MIT unless a separate contributor agreement says
otherwise.

Keep proprietary code in a separate private service or module with a clear API
boundary. Candidate paid value includes managed model execution, organization
policy management, retained audit history, cross-repository analytics, and an
SLA. Changing this repository's license, moving code to a private repository, or
creating a proprietary distribution requires a separate owner decision and is
outside this change.

## Packaging and initial pricing hypothesis

Pricing is per GitHub organization, not per developer seat. Seats are a poor
proxy for PR-analysis cost and create confusing access rules. Use simple plan
limits based on enabled private repositories and monthly analyses:

| Plan | Price hypothesis | Included use | Entitlement |
| --- | ---: | --- | --- |
| Community | $0 | Current local deterministic and BYOK-AI features | No service check |
| Team | $49/org/month or $490/year | 10 private repositories, 2,000 analyses/month | `team` |
| Business | $149/org/month or $1,490/year | 50 private repositories, 10,000 analyses/month | `business` |
| Enterprise | Annual contract | Custom limits, support/SLA, optional connected self-hosting | `enterprise` |

These prices are a launch hypothesis to validate before enabling billing. Do not
sell a plan until it has a concrete server-side benefit that the MIT Action does
not already provide. Prefer warnings and an upgrade window as usage approaches a
limit; reserve `quota_exceeded` for a clearly disclosed hard limit.

Offer one 14-day trial per immutable GitHub organization ID. Marketplace trials
are fixed at 14 days, so use the same duration for external checkout. A trial is
organization-wide and cannot be reset by renaming the organization or
reinstalling the App.

## Organization entitlement rules

- Key accounts by GitHub numeric organization ID. Treat the login as mutable
  display data.
- Bind OIDC authentication to `repository_owner_id` and confirm the repository
  is owned by that organization. Never trust the organization string in the
  request body by itself.
- A plan applies only to repositories selected for the companion App installation
  and within the plan's repository limit. Individual-owned repositories remain
  Community unless an individual plan is deliberately added later.
- `active` and unexpired `trialing` permit commercial features. `expired`,
  `canceled`, `not_entitled`, and `quota_exceeded` deny them.
- A paid cancellation stays active through its paid-through date. At the
  effective cancellation time, commercial mode is denied while Community mode
  remains available. Canceling a trial takes effect immediately.

## Billing channel

Use an **external billing provider for the first commercial release**, behind a
billing-provider adapter. Add GitHub Marketplace billing through a companion
GitHub App after demand and installation volume justify it.

Marketplace is strategically attractive because purchase, installation, and
organization identity share one GitHub-native flow. It supports flat-rate and
per-unit plans, fixed 14-day trials, and monthly/annual billing. It is not the
best starting point here: MergeRisk currently has no App or backend, and GitHub's
current paid-listing requirements include verified-publisher onboarding,
Marketplace lifecycle handling, monthly and annual prices, and guidance that a
GitHub App should have at least 100 installations. External billing also handles
enterprise invoicing and non-seat usage tiers more naturally.

Do not publish a free companion App listing while selling the same service only
outside Marketplace without reviewing Marketplace terms: GitHub states that an
eligible free listing with an externally paid version must also offer a paid
Marketplace plan. Keep the entitlement model independent of billing source so a
Marketplace subscription can be added without changing the Action contract.

Current GitHub references:

- [Requirements for listing an app](https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/requirements-for-listing-an-app)
- [Pricing plans for GitHub Marketplace apps](https://docs.github.com/en/apps/github-marketplace/selling-your-app-on-github-marketplace/pricing-plans-for-github-marketplace-apps)
- [Handling purchases and free trials](https://docs.github.com/en/apps/github-marketplace/using-the-github-marketplace-api-in-your-app/handling-new-purchases-and-free-trials)
- [Handling cancellations](https://docs.github.com/en/apps/github-marketplace/using-the-github-marketplace-api-in-your-app/handling-plan-cancellations)

## Runtime availability policy

Commercial mode uses a fixed hybrid policy; callers cannot weaken it with an
input:

- **Fail closed** for a verified deny, expired/canceled plan, invalid credentials,
  malformed success response, insecure/missing endpoint, or missing OIDC
  permission. These are entitlement or configuration decisions, not outages.
- **Fail open for that run** on a network error, timeout, HTTP 408/429, or HTTP
  5xx. The timeout defaults to 3 seconds and is capped at 10 seconds. Emit a
  warning and continue so a licensing outage does not stop customers' merge
  queues.
- **Always continue locally** in Community mode. This covers self-hosted or
  offline runners using the existing feature set and performs no entitlement
  authentication or network request.

Fail-open outages accept some revenue leakage. That tradeoff is appropriate for
an advisory CI check and public client code. Monitor fail-open volume, rate-limit
by verified organization, and enforce again at any premium API. A later signed,
short-lived entitlement lease can narrow the outage window without making CI
availability depend on a live request.

## Security and privacy

On GitHub.com, request a short-lived GitHub Actions OIDC token with audience
`mergerisk-entitlement-v1`; commercial workflows must grant `id-token: write`.
The service validates GitHub's issuer and signature, exact audience, expiry, and
immutable `repository_owner_id` and `repository_id` claims. GitHub documents
these claims in its [OIDC reference](https://docs.github.com/en/actions/reference/security/oidc).

A scoped `entitlement-token` is an explicit fallback for environments where OIDC
is unavailable. Store it as an organization secret, bind it to one organization,
make it revocable, and rotate it. The Action masks either credential before the
request. It never sends `github-token`, AI keys, pull request patches, file names,
comments, or report content to the entitlement service. The v1 request contains
only product/feature identifiers and the repository owner/name used for claim
matching. Do not log bearer tokens, raw OIDC claims, webhook secrets, or response
bodies.

Use HTTPS only, a small request body, strict response parsing, bounded timeouts,
generic user messages, webhook signature verification, replay/idempotency
protection, least-privilege App permissions, encrypted secrets, and auditable
entitlement transitions.

## Enforcement limitations

The Action source and bundled JavaScript are public. A user can pin an old MIT
version, fork the Action, patch out a check, replay a response, or replace the
entire client. Obfuscation or signed client code cannot make a durable trust
boundary on a runner the customer controls. The local check is useful for fast,
clear configuration feedback only.

Durable enforcement must protect something the public Action cannot reproduce:
a hosted model, managed policy, retained data, or another proprietary service.
That service must authenticate and authorize every request; it must not accept a
client assertion that a prior entitlement check succeeded.

## Consequences

- Existing Community users see no new permission, network dependency, or failure.
- Commercial adopters opt into an additional OIDC permission and service call.
- A future backend and billing source can evolve behind a versioned interface.
- This change does not create a GitHub App, deploy a service, enable billing,
  change repository visibility, or alter the MIT license.
