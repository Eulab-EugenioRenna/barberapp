import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import {
  ALORA_FUNCTIONS,
  canUseLocalFunction,
  createFunctionMatrix,
  hasAllLocalFunctions,
} from "./function-catalog";
import { OPERATIONS } from "./operation-catalog";
import { authorizeLocalOperation } from "./local-policy.guard";
import { RequestSession } from "./request-session";

function controllerFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? controllerFiles(path)
      : entry.name.endsWith(".controller.ts")
        ? [path]
        : [];
  });
}

describe("ALORA function catalog", () => {
  it("classifies every HTTP handler exactly once and references real functions", () => {
    const handlers: string[] = [];
    for (const path of controllerFiles(join(process.cwd(), "apps/api/src"))) {
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const declaration of source.statements.filter(
        ts.isClassDeclaration,
      )) {
        for (const member of declaration.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          if (
            !ts
              .getDecorators(member)
              ?.some((decorator) =>
                /^(Get|Post|Put|Patch|Delete|Sse|All|Head|Options)\(/.test(
                  decorator.expression.getText(source),
                ),
              )
          )
            continue;
          handlers.push(
            `${declaration.name!.text}.${member.name.getText(source)}`,
          );
        }
      }
    }
    expect(handlers.sort()).toEqual(Object.keys(OPERATIONS).sort());
    const keys = ALORA_FUNCTIONS.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const definition of Object.values(OPERATIONS)) {
      if (definition.kind !== "function") continue;
      expect(keys).toContain(definition.key);
      if (definition.own) expect(keys).toContain(definition.own);
    }
  });

  it("preserves legacy collaborator defaults and honors an explicitly empty local policy", () => {
    const legacy = { role: "collaborator", permissions: [], collaboratorId: "own", connectFunctions: ["appointments.read.own", "appointments.update.own"] };
    expect(canUseLocalFunction(legacy, "appointments.read.own")).toBe(true);
    expect(canUseLocalFunction({ ...legacy, permissionsConfigured: true }, "appointments.read.own")).toBe(false);
    expect(canUseLocalFunction({ ...legacy, permissionsConfigured: true, permissions: ["appointments.read.own"] }, "appointments.read.own")).toBe(true);
    expect(canUseLocalFunction({ ...legacy, permissionsConfigured: true, permissions: ["dashboard.revenue.read"], connectFunctions: ["dashboard.revenue.read"] }, "dashboard.revenue.read")).toBe(false);
  });

  it("preserves the native owner role for a short EULab access-as session", () => {
    expect(
      canUseLocalFunction(
        { role: "owner", technicalAccess: true },
        "services.manage",
      ),
    ).toBe(true);
    expect(
      canUseLocalFunction(
        { role: "owner", technicalAccess: true },
        "not-a-real-function",
      ),
    ).toBe(false);
    expect(
      canUseLocalFunction(
        { role: "manager", technicalAccess: true, permissions: [] },
        "services.manage",
      ),
    ).toBe(false);
  });

  it("requires explicit local configuration and Connect grant for personal economic values", () => {
    const user = { role: "collaborator", collaboratorId: "own", permissions: ["dashboard.personal.values.read"], connectFunctions: ["dashboard.personal.values.read"] };
    expect(canUseLocalFunction(user, "dashboard.personal.values.read")).toBe(false);
    expect(canUseLocalFunction({ ...user, permissionsConfigured: true }, "dashboard.personal.values.read")).toBe(true);
    expect(canUseLocalFunction({ ...user, permissionsConfigured: true, connectFunctions: [] }, "dashboard.personal.values.read")).toBe(false);
  });

  it("requires dedicated Connect and local grants for WhatsApp without settings aliases", () => {
    for (const key of ["whatsapp.read", "whatsapp.send", "whatsapp.manage"]) {
      expect(canUseLocalFunction({ role: "owner" }, key)).toBe(false);
      expect(canUseLocalFunction({ role: "owner", connectFunctions: [key] }, key)).toBe(true);
      expect(canUseLocalFunction({ role: "manager", permissions: ["settings.manage"], connectFunctions: [key] }, key)).toBe(false);
      expect(canUseLocalFunction({ role: "manager", permissions: [key], connectFunctions: [key] }, key)).toBe(true);
      expect(canUseLocalFunction({ role: "manager", permissions: [key], connectFunctions: [] }, key)).toBe(false);
    }
  });

  it("projects only Connect contract fields, with a stable versioned document", () => {
    const matrix = createFunctionMatrix("alora-test");
    expect(Object.keys(matrix).sort()).toEqual([
      "appId",
      "functions",
      "schemaVersion",
      "version",
    ]);
    expect(matrix.schemaVersion).toBe(1);
    expect(Number.isSafeInteger(matrix.version)).toBe(true);
    for (const item of matrix.functions)
      expect(Object.keys(item).sort()).toEqual(["description", "key", "name"]);
    // Publishing a changed catalog requires a deliberate version decision and snapshot review.
    expect(matrix).toMatchSnapshot();
    expect(() => createFunctionMatrix("host/tenant")).toThrow();
    expect(() => createFunctionMatrix("")).toThrow();
  });

  it.each(["owner", "platform_admin", "manager", "reception", "collaborator"])(
    "denies unknown functions and operations for %s",
    (role) => {
      const user = {
        role,
        permissions: ["future.manage"],
        collaboratorId: "c1",
      };
      expect(canUseLocalFunction(user, "future.manage")).toBe(false);
      const session: RequestSession = {
        tenantId: "t1",
        user: {
          id: "u1",
          tenantId: "t1",
          email: "u@example.test",
          firstName: "U",
          lastName: "S",
          ...user,
        },
      };
      expect(() =>
        authorizeLocalOperation(
          session,
          "ServicesController",
          "newUnclassifiedHandler",
        ),
      ).toThrow("Operazione non censita");
      expect(() =>
        authorizeLocalOperation(
          session,
          "PublicBookingController",
          "newUnclassifiedHandler",
        ),
      ).toThrow();
      expect(() =>
        authorizeLocalOperation(
          session,
          "PlatformAdminController",
          "newUnclassifiedHandler",
        ),
      ).toThrow();
    },
  );

  it("preserves explicit aliases without assigning unrelated capabilities", () => {
    const user = { role: "manager", permissions: ["settings.manage"] };
    expect(canUseLocalFunction(user, "notifications.read")).toBe(true);
    expect(canUseLocalFunction(user, "notifications.manage")).toBe(true);
    expect(canUseLocalFunction(user, "sales.manage")).toBe(false);
    expect(
      canUseLocalFunction(
        { role: "manager", permissions: ["notifications.read"] },
        "settings.manage",
      ),
    ).toBe(false);
    expect(
      canUseLocalFunction(
        {
          role: "collaborator",
          collaboratorId: "c1",
          permissions: ["appointments.read.all"],
        },
        "appointments.read.all",
      ),
    ).toBe(false);
  });
});

describe("hasAllLocalFunctions (PRO)", () => {
  const all = ALORA_FUNCTIONS.map((item) => item.key);
  it("is true only when Connect grants every function to the owner", () => {
    expect(hasAllLocalFunctions({ role: "owner", connectFunctions: all } as any)).toBe(true);
    expect(
      hasAllLocalFunctions({ role: "owner", connectFunctions: all.slice(1) } as any),
    ).toBe(false);
  });
  it("ignores technical access, collaborators and missing users", () => {
    expect(hasAllLocalFunctions({ role: "owner", technicalAccess: true } as any)).toBe(false);
    expect(
      hasAllLocalFunctions({ role: "collaborator", collaboratorId: "c", connectFunctions: all } as any),
    ).toBe(false);
    expect(hasAllLocalFunctions(null)).toBe(false);
  });
});

describe("Unified permissions (catalogue v9)", () => {
  const owner = (connectFunctions: string[]) => ({ role: "owner", connectFunctions }) as any;
  const reception = (permissions: string[]) => ({ role: "reception", permissions }) as any;
  const published = ALORA_FUNCTIONS.map((item) => item.key) as string[];

  it("lets managing include reading, in Connect and in local roles", () => {
    for (const [manage, read] of [
      ["sales.manage", "sales.read"],
      ["clients.manage", "clients.read.full"],
      ["services.manage", "services.read"],
      ["inventory.manage", "inventory.read"],
      ["locations.manage", "locations.read"],
      ["collaborators.manage", "collaborators.read"],
      ["appointments.update.all", "appointments.read.all"],
      ["whatsapp.send", "whatsapp.read"],
      ["whatsapp.manage", "whatsapp.read"],
      ["team.manage", "users.manage"],
      ["team.password.reset", "users.manage"],
      ["notifications.manage", "notifications.read"],
    ]) {
      expect(canUseLocalFunction(owner([manage]), read)).toBe(true);
      expect(canUseLocalFunction(reception([manage]), read)).toBe(true);
      // Never the other way round.
      expect(canUseLocalFunction(owner([read]), manage)).toBe(false);
    }
  });

  it("keeps old merged keys working and no longer publishes them", () => {
    expect(published).not.toEqual(expect.arrayContaining(["products.read"]));
    expect(published).not.toContain("products.manage");
    expect(published).not.toContain("confirmations.read");
    expect(canUseLocalFunction(owner(["products.read"]), "services.read")).toBe(true);
    expect(canUseLocalFunction(owner(["confirmations.read"]), "sales.read")).toBe(true);
    expect(canUseLocalFunction(owner(["services.manage"]), "products.manage")).toBe(true);
  });

  it("gives whoever sells or books the lists the form needs", () => {
    const cashier = { tenantId: "t", user: { role: "reception", permissions: ["sales.manage"] } } as any;
    const booker = { tenantId: "t", user: { role: "reception", permissions: ["appointments.create"] } } as any;
    for (const operation of [
      ["ServicesController", "findAll"],
      ["ProductsController", "findAll"],
      ["ProductsController", "byBarcode"],
      ["CustomersController", "findAll"],
      ["CollaboratorsController", "options"],
      ["SalesController", "quote"],
    ])
      expect(() => authorizeLocalOperation(cashier, operation[0], operation[1])).not.toThrow();
    for (const operation of [
      ["AppointmentsController", "context"],
      ["ServicesController", "findAll"],
      ["CustomersController", "findAll"],
      ["CollaboratorsController", "options"],
    ])
      expect(() => authorizeLocalOperation(booker, operation[0], operation[1])).not.toThrow();
    // Pick lists do not open the pages themselves.
    expect(() => authorizeLocalOperation(cashier, "CustomersController", "history")).toThrow();
    expect(() => authorizeLocalOperation(booker, "AppointmentsController", "findAll")).toThrow();
  });

  it("references only functions that exist in every operation", () => {
    for (const [name, definition] of Object.entries(OPERATIONS))
      if (definition.kind === "function")
        for (const key of [definition.key, definition.own, ...(definition.anyOf ?? [])].filter(Boolean))
          expect([name, published.includes(key as string)]).toEqual([name, true]);
  });
});
