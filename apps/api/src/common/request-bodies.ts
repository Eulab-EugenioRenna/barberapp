import { json, raw, urlencoded } from "body-parser";
import type { INestApplication } from "@nestjs/common";

/** Signed webhook bytes are captured untouched; ordinary API payload limits remain unchanged. */
export function configureRequestBodies(app: Pick<INestApplication, "use">) {
  app.use(
    /^\/notifications\/automation-webhooks\/[a-f\d-]+\/events\/?$/i,
    raw({ type: "application/json", limit: "16mb", inflate: false }),
  );
  app.use(json({ limit: "100kb" }));
  app.use(urlencoded({ extended: true, limit: "100kb" }));
}
