import type { EntitlementConfig } from "../types.js";

export const ENTITLEMENT_AUDIENCE = "mergerisk-entitlement-v1";

export type ActiveEntitlementStatus = "active" | "trialing";
export type InactiveEntitlementStatus =
  | "canceled"
  | "expired"
  | "not_entitled"
  | "quota_exceeded";

export interface EntitlementIdentity {
  organization: string;
  repository: string;
}

export interface EntitlementRequest extends EntitlementIdentity {
  contractVersion: 1;
  product: "mergerisk";
  feature: "commercial-action";
}

export type EntitlementCheckResult =
  | {
      kind: "allowed";
      status: ActiveEntitlementStatus;
      plan?: string;
      validUntil?: string;
    }
  | {
      kind: "denied";
      status: InactiveEntitlementStatus;
      reasonCode: "authorization_failed" | "invalid_response" | "not_active";
    }
  | {
      kind: "unavailable";
      reason: "network" | "rate_limited" | "server" | "timeout";
    };

export interface EntitlementClient {
  check(
    request: EntitlementRequest,
    bearerToken: string,
  ): Promise<EntitlementCheckResult>;
}

export interface EntitlementRuntime {
  getOidcToken(audience: string): Promise<string>;
  maskSecret(secret: string): void;
  info(message: string): void;
  warning(message: string): void;
}

export type EntitlementOutcome =
  | { mode: "community" }
  | {
      mode: "commercial";
      state: "entitled";
      status: ActiveEntitlementStatus;
    }
  | { mode: "commercial"; state: "service_unavailable" };

type Fetch = typeof fetch;

interface ServiceResponse {
  contract_version?: unknown;
  decision?: unknown;
  status?: unknown;
  plan?: unknown;
  valid_until?: unknown;
}

const activeStatuses = new Set<ActiveEntitlementStatus>([
  "active",
  "trialing",
]);
const inactiveStatuses = new Set<InactiveEntitlementStatus>([
  "canceled",
  "expired",
  "not_entitled",
  "quota_exceeded",
]);

function invalidResponse(): EntitlementCheckResult {
  return {
    kind: "denied",
    status: "not_entitled",
    reasonCode: "invalid_response",
  };
}

function parseServiceResponse(value: unknown): EntitlementCheckResult {
  if (!value || typeof value !== "object") {
    return invalidResponse();
  }

  const response = value as ServiceResponse;
  if (response.contract_version !== 1) {
    return invalidResponse();
  }

  if (
    response.decision === "allow" &&
    activeStatuses.has(response.status as ActiveEntitlementStatus)
  ) {
    if (response.plan !== undefined && typeof response.plan !== "string") {
      return invalidResponse();
    }
    if (
      response.valid_until !== undefined &&
      (typeof response.valid_until !== "string" ||
        !Number.isFinite(Date.parse(response.valid_until)))
    ) {
      return invalidResponse();
    }
    if (
      typeof response.valid_until === "string" &&
      Date.parse(response.valid_until) <= Date.now()
    ) {
      return {
        kind: "denied",
        status: "expired",
        reasonCode: "not_active",
      };
    }
    return {
      kind: "allowed",
      status: response.status as ActiveEntitlementStatus,
      ...(typeof response.plan === "string" ? { plan: response.plan } : {}),
      ...(typeof response.valid_until === "string"
        ? { validUntil: response.valid_until }
        : {}),
    };
  }

  if (
    response.decision === "deny" &&
    inactiveStatuses.has(response.status as InactiveEntitlementStatus)
  ) {
    return {
      kind: "denied",
      status: response.status as InactiveEntitlementStatus,
      reasonCode: "not_active",
    };
  }

  return invalidResponse();
}

export class HttpEntitlementClient implements EntitlementClient {
  constructor(
    private readonly serviceUrl: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async check(
    request: EntitlementRequest,
    bearerToken: string,
  ): Promise<EntitlementCheckResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.serviceUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${bearerToken}`,
          "content-type": "application/json",
          "user-agent": "mergerisk-action/entitlement-v1",
        },
        body: JSON.stringify({
          contract_version: request.contractVersion,
          product: request.product,
          feature: request.feature,
          organization: request.organization,
          repository: request.repository,
        }),
        redirect: "error",
        signal: controller.signal,
      });

      if (response.status === 408 || response.status === 429) {
        return {
          kind: "unavailable",
          reason: response.status === 429 ? "rate_limited" : "timeout",
        };
      }
      if (response.status >= 500) {
        return { kind: "unavailable", reason: "server" };
      }
      if (!response.ok) {
        return {
          kind: "denied",
          status: "not_entitled",
          reasonCode: "authorization_failed",
        };
      }

      try {
        return parseServiceResponse(await response.json());
      } catch {
        return invalidResponse();
      }
    } catch {
      return {
        kind: "unavailable",
        reason: controller.signal.aborted ? "timeout" : "network",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function denialMessage(
  organization: string,
  status: InactiveEntitlementStatus,
): string {
  const state = status.replace("_", " ");
  return (
    `MergeRisk commercial entitlement is not active for organization ` +
    `${organization} (${state}). Current community features remain available ` +
    "with entitlement-mode: community; commercial features require an active plan."
  );
}

export async function enforceEntitlement(
  config: EntitlementConfig,
  identity: EntitlementIdentity,
  runtime: EntitlementRuntime,
  client: EntitlementClient = new HttpEntitlementClient(
    config.serviceUrl,
    config.timeoutMs,
  ),
): Promise<EntitlementOutcome> {
  if (config.mode === "community") {
    runtime.info(
      "MergeRisk Community mode: no commercial entitlement check is required.",
    );
    return { mode: "community" };
  }

  let token = config.token;
  if (!token) {
    try {
      token = await runtime.getOidcToken(ENTITLEMENT_AUDIENCE);
    } catch {
      throw new Error(
        "MergeRisk commercial entitlement authentication is unavailable. " +
          "Grant the workflow id-token: write permission or provide a scoped entitlement-token.",
      );
    }
  }
  if (!token) {
    throw new Error(
      "MergeRisk commercial entitlement authentication returned an empty token.",
    );
  }
  runtime.maskSecret(token);

  const result = await client.check(
    {
      contractVersion: 1,
      product: "mergerisk",
      feature: "commercial-action",
      organization: identity.organization,
      repository: identity.repository,
    },
    token,
  );

  if (result.kind === "unavailable") {
    runtime.warning(
      `MergeRisk entitlement service is temporarily unavailable; continuing this run under the documented outage policy (${config.timeoutMs} ms timeout).`,
    );
    return { mode: "commercial", state: "service_unavailable" };
  }
  if (result.kind === "denied") {
    throw new Error(denialMessage(identity.organization, result.status));
  }

  runtime.info(
    `MergeRisk commercial entitlement confirmed for organization ${identity.organization} (${result.status}).`,
  );
  return {
    mode: "commercial",
    state: "entitled",
    status: result.status,
  };
}
