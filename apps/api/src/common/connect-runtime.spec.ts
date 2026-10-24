import { canUseLocalFunction } from "./function-catalog";
import { connectConfig, openConnect, sealConnect } from "./connect-runtime";

describe("Connect boundary", () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env = {
      ...original,
      ALORA_CONNECT_ENCRYPTION_KEY: "a".repeat(64),
      ALORA_CONNECT_API_URL: "http://127.0.0.1:8088",
      ALORA_CONNECT_ISSUER: "http://127.0.0.1:8080/realms/test",
      ALORA_CONNECT_CLIENT_ID: "alora-client",
      ALORA_CONNECT_CALLBACK_URL:
        "http://127.0.0.1:53020/api/auth/connect/callback",
      ALORA_AUTH_RETURN_URL: "http://127.0.0.1:53020/admin/#/login",
      ALORA_CONNECT_APP_ID: "alora",
      ALORA_CONNECT_TENANTS_JSON: JSON.stringify({
        t1: { customerId: "c1", installationId: "i1", secret: "synthetic" },
      }),
    };
  });
  afterEach(() => {
    process.env = original;
  });
  it("configures only explicitly mapped tenants, without a public-host fallback", () => {
    expect(connectConfig("t2")).toBeNull();
    expect(connectConfig("t1")?.installationId).toBe("i1");
    delete process.env["ALORA_CONNECT_ISSUER"];
    expect(() => connectConfig("t1")).toThrow(
      "Configurazione Connect incompleta",
    );
  });
  it("rejects cross-origin callbacks, non-HTTPS production and missing encryption keys", () => {
    process.env["ALORA_CONNECT_CALLBACK_URL"] =
      "https://other.example/callback";
    expect(() => connectConfig("t1")).toThrow();
    process.env["ALORA_CONNECT_CALLBACK_URL"] =
      "http://127.0.0.1:53020/api/auth/connect/callback";
    process.env["NODE_ENV"] = "production";
    expect(() => connectConfig("t1")).toThrow();
    process.env["NODE_ENV"] = "test";
    delete process.env["ALORA_CONNECT_ENCRYPTION_KEY"];
    expect(() => sealConnect("provider-token")).toThrow();
  });
  it("encrypts credentials with authentication and a different IV each time", () => {
    const one = sealConnect("provider-token"),
      two = sealConnect("provider-token");
    expect(one).not.toBe(two);
    expect(one).not.toContain("provider-token");
    expect(openConnect(one)).toBe("provider-token");
    const parts = one.split(".");
    parts[3] = "A" + parts[3].slice(1);
    if (parts.join(".") === one) parts[3] = "B" + parts[3].slice(1);
    expect(() => openConnect(parts.join("."))).toThrow();
  });
  it("never turns an owner or local alias into a Connect grant", () => {
    expect(
      canUseLocalFunction(
        { role: "owner", connectFunctions: [] },
        "services.manage",
      ),
    ).toBe(false);
    expect(
      canUseLocalFunction(
        {
          role: "manager",
          permissions: ["settings.manage"],
          connectFunctions: ["settings.manage"],
        },
        "notifications.manage",
      ),
    ).toBe(false);
    expect(
      canUseLocalFunction(
        { role: "owner", connectFunctions: ["services.read"] },
        "services.read",
      ),
    ).toBe(true);
    expect(
      canUseLocalFunction(
        {
          role: "collaborator",
          collaboratorId: "c1",
          connectFunctions: ["appointments.read.own"],
        },
        "appointments.read.own",
      ),
    ).toBe(true);
    expect(
      canUseLocalFunction(
        {
          role: "collaborator",
          collaboratorId: "c1",
          connectFunctions: ["appointments.read.all"],
        },
        "appointments.read.all",
      ),
    ).toBe(false);
  });
});
