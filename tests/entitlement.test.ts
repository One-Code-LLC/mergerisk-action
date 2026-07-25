import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ENTITLEMENT_AUDIENCE,
  HttpEntitlementClient,
  enforceEntitlement,
  type EntitlementClient,
  type EntitlementRuntime,
} from "../src/entitlement/check.js";
import type { EntitlementConfig } from "../src/types.js";

function config(overrides: Partial<EntitlementConfig> = {}): EntitlementConfig {
  return {
    mode: "commercial",
    serviceUrl: "https://entitlements.example.com/v1/check",
    token: "",
    timeoutMs: 3000,
    ...overrides,
  };
}

function response(
  status: number,
  body: unknown,
): Pick<Response, "json" | "ok" | "status"> {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body),
  };
}

const identity = {
  organization: "acme",
  repository: "acme/app",
};

describe("commercial entitlement enforcement", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let runtime: EntitlementRuntime;

  beforeEach(() => {
    fetchMock = vi.fn();
    runtime = {
      getOidcToken: vi.fn().mockResolvedValue("github-oidc-token"),
      maskSecret: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    };
  });

  it("allows a valid organization entitlement using a masked OIDC token", async () => {
    fetchMock.mockResolvedValue(
      response(200, {
        contract_version: 1,
        decision: "allow",
        status: "active",
        plan: "team",
        valid_until: "2099-08-21T00:00:00Z",
      }),
    );
    const client = new HttpEntitlementClient(
      config().serviceUrl,
      config().timeoutMs,
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      enforceEntitlement(config(), identity, runtime, client),
    ).resolves.toEqual({
      mode: "commercial",
      state: "entitled",
      status: "active",
    });

    expect(runtime.getOidcToken).toHaveBeenCalledWith(ENTITLEMENT_AUDIENCE);
    expect(runtime.maskSecret).toHaveBeenCalledWith("github-oidc-token");
    expect(fetchMock).toHaveBeenCalledWith(
      config().serviceUrl,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer github-oidc-token",
        }),
      }),
    );
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody).toEqual({
      contract_version: 1,
      product: "mergerisk",
      feature: "commercial-action",
      organization: "acme",
      repository: "acme/app",
    });
  });

  it("fails closed when credentials or an entitlement are invalid", async () => {
    fetchMock.mockResolvedValue(
      response(401, { error: "do-not-log-this-response-or-secret" }),
    );
    const client = new HttpEntitlementClient(
      config().serviceUrl,
      config().timeoutMs,
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      enforceEntitlement(config(), identity, runtime, client),
    ).rejects.toThrow(
      "MergeRisk commercial entitlement is not active for organization acme (not entitled)",
    );

    const messages = [
      ...vi.mocked(runtime.info).mock.calls.flat(),
      ...vi.mocked(runtime.warning).mock.calls.flat(),
    ].join(" ");
    expect(messages).not.toContain("github-oidc-token");
    expect(messages).not.toContain("do-not-log-this-response-or-secret");
  });

  it.each(["expired", "canceled"] as const)(
    "fails closed for a %s plan",
    async (status) => {
      fetchMock.mockResolvedValue(
        response(200, {
          contract_version: 1,
          decision: "deny",
          status,
        }),
      );
      const client = new HttpEntitlementClient(
        config().serviceUrl,
        config().timeoutMs,
        fetchMock as unknown as typeof fetch,
      );

      await expect(
        enforceEntitlement(config(), identity, runtime, client),
      ).rejects.toThrow(`organization acme (${status})`);
    },
  );

  it("treats a stale allow response as expired", async () => {
    fetchMock.mockResolvedValue(
      response(200, {
        contract_version: 1,
        decision: "allow",
        status: "active",
        valid_until: "2020-01-01T00:00:00Z",
      }),
    );
    const client = new HttpEntitlementClient(
      config().serviceUrl,
      config().timeoutMs,
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      enforceEntitlement(config(), identity, runtime, client),
    ).rejects.toThrow("organization acme (expired)");
  });

  it("fails open for a temporary API failure", async () => {
    fetchMock.mockResolvedValue(response(503, { error: "unavailable" }));
    const client = new HttpEntitlementClient(
      config().serviceUrl,
      config().timeoutMs,
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      enforceEntitlement(config(), identity, runtime, client),
    ).resolves.toEqual({
      mode: "commercial",
      state: "service_unavailable",
    });
    expect(runtime.warning).toHaveBeenCalledWith(
      expect.stringContaining("continuing this run"),
    );
  });

  it("bounds a hung entitlement request with the configured timeout", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const client = new HttpEntitlementClient(
      config().serviceUrl,
      5,
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      client.check(
        {
          contractVersion: 1,
          product: "mergerisk",
          feature: "commercial-action",
          ...identity,
        },
        "token",
      ),
    ).resolves.toEqual({ kind: "unavailable", reason: "timeout" });
  });

  it("keeps community use on self-hosted or offline runners fully local", async () => {
    const client: EntitlementClient = {
      check: vi.fn().mockRejectedValue(new Error("network must not be used")),
    };

    await expect(
      enforceEntitlement(
        config({ mode: "community", serviceUrl: "", token: "" }),
        identity,
        runtime,
        client,
      ),
    ).resolves.toEqual({ mode: "community" });

    expect(client.check).not.toHaveBeenCalled();
    expect(runtime.getOidcToken).not.toHaveBeenCalled();
    expect(runtime.maskSecret).not.toHaveBeenCalled();
    expect(runtime.info).toHaveBeenCalledWith(
      "MergeRisk Community mode: no commercial entitlement check is required.",
    );
  });

  it("uses a masked scoped token without requesting OIDC", async () => {
    const client: EntitlementClient = {
      check: vi.fn().mockResolvedValue({
        kind: "allowed",
        status: "trialing",
      }),
    };

    await expect(
      enforceEntitlement(
        config({ token: "scoped-static-token" }),
        identity,
        runtime,
        client,
      ),
    ).resolves.toEqual({
      mode: "commercial",
      state: "entitled",
      status: "trialing",
    });

    expect(runtime.getOidcToken).not.toHaveBeenCalled();
    expect(runtime.maskSecret).toHaveBeenCalledWith("scoped-static-token");
  });

  it("fails closed when commercial authentication cannot be initialized", async () => {
    vi.mocked(runtime.getOidcToken).mockRejectedValue(
      new Error("id-token permission missing"),
    );
    const client: EntitlementClient = { check: vi.fn() };

    await expect(
      enforceEntitlement(config(), identity, runtime, client),
    ).rejects.toThrow("Grant the workflow id-token: write permission");
    expect(client.check).not.toHaveBeenCalled();
  });

  it("fails closed on a malformed success response", async () => {
    fetchMock.mockResolvedValue(
      response(200, {
        decision: "allow",
        status: "active",
      }),
    );
    const client = new HttpEntitlementClient(
      config().serviceUrl,
      config().timeoutMs,
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      enforceEntitlement(config(), identity, runtime, client),
    ).rejects.toThrow("organization acme (not entitled)");
  });
});
