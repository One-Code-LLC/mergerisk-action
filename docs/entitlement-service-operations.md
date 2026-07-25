# Entitlement service operations

This is the backend contract and runbook for the repository-side foundation. No
service or GitHub App is included in this repository.

## Public check API

Expose one HTTPS endpoint, for example:

```text
POST https://entitlements.mergerisk.example/v1/check
Authorization: Bearer <GitHub OIDC JWT or scoped service token>
Content-Type: application/json
```

Request contract:

```json
{
  "contract_version": 1,
  "product": "mergerisk",
  "feature": "commercial-action",
  "organization": "octo-org",
  "repository": "octo-org/example"
}
```

The organization and repository strings are hints to compare with authenticated
claims, not identity proof. Do not add PR numbers, refs, actors, file names,
patches, report bodies, GitHub tokens, or AI credentials to this contract.

Allowed response:

```json
{
  "contract_version": 1,
  "decision": "allow",
  "status": "active",
  "plan": "team",
  "valid_until": "2026-08-21T00:00:00Z"
}
```

`status` may be `active` or `trialing` when `decision` is `allow`. A past
`valid_until` is denied by the Action even if the decision says allow.

Denied response:

```json
{
  "contract_version": 1,
  "decision": "deny",
  "status": "expired"
}
```

Denied statuses are `expired`, `canceled`, `not_entitled`, and
`quota_exceeded`. Return a response body only for HTTP 200 decisions. Use 401 or
403 for rejected credentials, 400/422 for invalid requests, 429 for overload,
and 5xx only for transient server failures. The Action deliberately treats
408/429/5xx and transport failures as an outage, and other non-2xx or malformed
responses as fail-closed.

## Authentication and authorization

### GitHub.com OIDC

1. Fetch GitHub's OIDC discovery document and signing keys through a cached,
   rotating JWKS verifier.
2. Verify signature, issuer `https://token.actions.githubusercontent.com`, exact
   audience `mergerisk-entitlement-v1`, `exp`, and `nbf`/`iat` with a small clock
   skew allowance.
3. Require the `repository`, `repository_id`, `repository_owner`, and
   `repository_owner_id` claims. Numeric IDs are authoritative across renames.
4. Compare the requested organization and repository with the verified claims.
   Reject mismatches; never use request strings to select another customer's
   entitlement.
5. Look up entitlement by `(billing_source, github_account_id)`, then enforce
   plan state, time bounds, App installation selection, repository limit, and
   usage limit.

Do not require a custom organization OIDC subject template. Validate individual
claims rather than parsing identity from `sub`, because GitHub's subject formats
can differ by account and rollout state.

### Scoped fallback tokens

For GitHub Enterprise Server or connected self-hosted environments without OIDC,
issue a random, high-entropy token scoped to one GitHub organization ID and this
single check API. Store only a keyed hash, show the token once, support
overlapping rotation, and record last-used time without recording the token.
Static tokens do not make a fully offline commercial product; a separately
licensed offline lease would be a future product and needs signed grants, clock
rollback defenses, and its own support policy.

## Suggested data model

Keep billing facts separate from computed entitlements:

- `accounts`: GitHub numeric account ID, current login, account type, App
  installation ID, installation state.
- `subscriptions`: billing source (`external` or `github_marketplace`), immutable
  provider customer/subscription IDs, plan, state, trial end, current period end,
  cancellation effective time, purchased units.
- `repository_grants`: selected repository IDs where plan limits require an
  allowlist.
- `usage_periods`: account, plan metric, period, committed usage, limit.
- `billing_events`: provider delivery ID, payload digest, event type, received and
  applied timestamps, processing result. Delivery ID must be unique.
- `entitlement_audit`: old/new state, reason, source event, effective time, and
  operator identity for manual changes.

Compute the check response from these records. Do not store OIDC JWTs or raw
authorization headers.

## GitHub Marketplace lifecycle

Create the companion GitHub App only after product approval. Give it the minimum
repository and organization permissions required for the paid service; billing
events themselves do not justify code access. Marketplace requires an OAuth user
authorization flow for a Marketplace GitHub App, so keep the purchaser/account
linking flow distinct from the Action's OIDC authentication.

Configure the Marketplace listing webhook and verify `X-Hub-Signature-256` over
the exact raw request body before parsing. Store `X-GitHub-Delivery` under a
unique constraint, acknowledge duplicates, and process transitions in a durable
queue or transaction. GitHub notes that failed Marketplace webhook deliveries
are not automatically redelivered, so alert on non-2xx deliveries and reconcile
periodically with the Marketplace API.

Handle `marketplace_purchase` actions as follows:

| Action | Required transition |
| --- | --- |
| `purchased` | Upsert the GitHub account and subscription. Set `trialing` when `on_free_trial` is true; otherwise set `active`. Persist plan ID, unit count, `effective_date`, next billing date, and `free_trial_ends_on`. |
| `changed` | Apply an upgrade at its effective time. Preserve access through the current period for a scheduled downgrade; apply the new plan when GitHub reports it effective. Store the previous purchase for audit. |
| `cancelled` | On trial cancellation, set `canceled` immediately. For paid plans, GitHub sends cancellation when the billing period ends; set `canceled`, revoke premium access, retain Community access, and begin the customer-data deletion workflow. |

GitHub's current lifecycle references are [new purchases and trials](https://docs.github.com/en/apps/github-marketplace/using-the-github-marketplace-api-in-your-app/handling-new-purchases-and-free-trials),
[plan changes](https://docs.github.com/en/apps/github-marketplace/using-the-github-marketplace-api-in-your-app/handling-plan-changes), and
[cancellations](https://docs.github.com/en/apps/github-marketplace/using-the-github-marketplace-api-in-your-app/handling-plan-cancellations).

Never key a transition only by login, assume delivery order, or turn a future
effective downgrade into an immediate denial. Reconciliation should list the
accounts for every Marketplace plan, compare plan/account IDs and effective
dates, repair missed events, and emit an audit entry.

For an external billing provider, translate checkout, trial, invoice-paid,
payment-failed, subscription-updated, and subscription-deleted events into the
same internal subscription states. Require a GitHub organization-owner linking
flow before attaching an external customer to a GitHub account ID.

## Availability and incident handling

- Target a p95 check latency below 300 ms and an availability objective at least
  as strong as the supported CI experience. The client abandons the request at
  3 seconds by default.
- Cache computed decisions briefly by authenticated organization/repository, but
  never beyond `valid_until` or a cancellation effective time. Invalidate on
  billing and installation events.
- Return 429 or 5xx during a genuine transient incident so clients use their
  documented fail-open path. Do not disguise an account denial as a server error.
- Alert on error rate, latency, fail-open estimates, signature failures, replayed
  deliveries, reconciliation drift, and manual entitlement overrides.
- During an outage, restore the read path first, reconcile billing events, then
  review fail-open usage. Do not retroactively fail customer CI jobs.

## Security and privacy checklist

- TLS, HSTS, bounded request size, JSON content-type enforcement, and rate limits
  keyed by verified identity.
- Managed secrets for webhook keys and provider credentials; rotation and access
  audit enabled.
- No bearer token, raw OIDC claim set, source metadata, or provider payload in
  application logs. Redact headers before error reporting.
- Encryption at rest, least-privilege database roles, migrations with rollback,
  backups with restore tests, and a documented data-retention schedule.
- Privacy policy, terms, support contact, status page, subprocessors, deletion
  workflow, and incident response ready before taking payment.
- Delete customer data within the applicable Marketplace window; GitHub currently
  specifies 30 days after a canceled plan or trial.

## Release and rollback

1. Deploy the service and validate contract tests before documenting a production
   `entitlement-url`.
2. Test allow, deny, cancellation, malformed response, authentication failure,
   timeout, 429, and 5xx against staging.
3. Test all Marketplace flows using a draft listing before requesting review.
4. Roll out commercial mode to internal organizations, then design partners.
5. Keep Community mode unchanged throughout rollout. If the service must be
   disabled, return a genuine 503 so opted-in jobs continue under outage policy;
   do not change known denials to 503 to bypass cancellation rules.

The remaining external setup is listed in the decision record and repository
README. None of it is performed by this implementation.
