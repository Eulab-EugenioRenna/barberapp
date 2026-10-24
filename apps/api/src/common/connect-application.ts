import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { ServiceUnavailableException } from "@nestjs/common";
import type {
  ConnectApplication,
  ConnectApplicationConfig,
  ConnectSqlPool,
} from "@eulab/connect/application";
import { connectApplicationConfig } from "./connect-runtime";
import { connectAccounts } from "./connect-accounts";
import { createFunctionMatrix } from "./function-catalog";

const loadApplication = new Function(
  "return import('@eulab/connect/application')",
) as () => Promise<typeof import("@eulab/connect/application")>;
// Use the SDK's minimal driver contract; pg's latest declaration files require a newer TS than Angular 18.
type ApplicationPool = ConnectSqlPool & {
  end(): Promise<void>;
  on(event: "error", listener: () => void): unknown;
};
const { Pool } = createRequire(__filename)("pg") as {
  Pool: new (config: Record<string, unknown>) => ApplicationPool;
};
const instances = new WeakMap<
  PrismaClient,
  {
    pool: ApplicationPool;
    application: Promise<ConnectApplication>;
    prune(): Promise<void>;
  }
>();

/** One SDK instance/store per API process and data source. Never runs migrations at login/startup. */
export async function connectApplication(
  prisma: PrismaClient,
): Promise<ConnectApplication> {
  const cached = instances.get(prisma);
  if (cached) return cached.application;
  const global = connectApplicationConfig();
  const sourceId = process.env["ALORA_CONNECT_SOURCE_ID"],
    sourceSecret = process.env["ALORA_CONNECT_BOOTSTRAP_SECRET"];
  const presenterId = process.env["ALORA_CONNECT_PRESENTER_ID"],
    presenterSecret = process.env["ALORA_CONNECT_PRESENTER_SECRET"];
  const presenter = presenterId || presenterSecret;
  if (
    !sourceId ||
    (presenter ? !presenterId || !presenterSecret : !sourceSecret)
  )
    throw new ServiceUnavailableException(
      "Collegamento Connect non configurato",
    );
  const pool = new Pool({
    connectionString: process.env["DATABASE_URL"],
    max: 8,
    connectionTimeoutMillis: 5000,
  });
  pool.on("error", () => {
    /* pg removes idle broken clients; no credential-bearing driver errors in logs. */
  });
  let store: import("@eulab/connect/application").PostgresConnectApplicationStore;
  const application = loadApplication().then((sdk) => {
    store = new sdk.PostgresConnectApplicationStore(
      pool,
      connectStoreNamespace(sourceId, global.appId),
    );
    const config: ConnectApplicationConfig = {
      apiUrl: global.apiUrl,
      oidcTransportOrigin: process.env["ALORA_CONNECT_OIDC_TRANSPORT_ORIGIN"] || undefined,
      appId: global.appId,
      sourceId,
      sourceSecret,
      ...(presenter
        ? {
            presenter: {
              id: presenterId!,
              secret: presenterSecret!,
              deployment: {
                name: process.env["ALORA_DEPLOYMENT_NAME"] || "ALORA",
                environment:
                  process.env["NODE_ENV"] === "production"
                    ? ("production" as const)
                    : ("development" as const),
                origins: [new URL(global.callbackUrl).origin],
                catalogUrl:
                  process.env["ALORA_CONNECT_CATALOG_URL"] ||
                  new URL(global.callbackUrl).origin +
                    "/.well-known/eulab-connect.json",
                oidcCallbacks: [global.callbackUrl],
              },
            },
          }
        : {}),
      ...(global.issuer
        ? {
            issuer: global.issuer,
            clientId: global.clientId,
            clientSecret:
              process.env["ALORA_CONNECT_CLIENT_SECRET"] || undefined,
            redirectUri: global.callbackUrl,
          }
        : {}),
      appOrigin: new URL(global.callbackUrl).origin,
      encryptionKey: process.env["ALORA_CONNECT_ENCRYPTION_KEY"]!,
      allowLoopbackHttp: process.env["NODE_ENV"] !== "production",
      store,
      accounts: connectAccounts(prisma, (code) => {
        throw new sdk.ConnectApplicationError(code);
      }),
      catalog: createFunctionMatrix(global.appId),
    };
    return new sdk.ConnectApplication(config);
  });
  instances.set(prisma, {
    pool,
    application,
    prune: async () => {
      await application;
      await store.prune();
    },
  });
  try {
    return await application;
  } catch {
    instances.delete(prisma);
    await pool.end();
    throw new ServiceUnavailableException("Configurazione Connect non valida");
  }
}
export function connectStoreNamespace(sourceId: string, appId: string): string {
  return (
    "alora:" +
    createHash("sha256")
      .update(
        JSON.stringify([
          process.env["NODE_ENV"] ?? "development",
          sourceId,
          appId,
        ]),
      )
      .digest("hex")
  );
}
export async function closeConnectApplication(
  prisma: PrismaClient,
): Promise<void> {
  const instance = instances.get(prisma);
  instances.delete(prisma);
  if (instance) await instance.pool.end();
}
export async function pruneConnectApplication(
  prisma: PrismaClient,
): Promise<void> {
  // Housekeeping never constructs a client for an unconfigured installation.
  await instances.get(prisma)?.prune();
}
