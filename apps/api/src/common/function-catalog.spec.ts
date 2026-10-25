import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import {
  ALORA_FUNCTIONS,
  canUseLocalFunction,
  createFunctionMatrix,
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

  it("requires explicit local configuration and Connect grant for personal economic values", () => {
    const user = { role: "collaborator", collaboratorId: "own", permissions: ["dashboard.personal.values.read"], connectFunctions: ["dashboard.personal.values.read"] };
    expect(canUseLocalFunction(user, "dashboard.personal.values.read")).toBe(false);
    expect(canUseLocalFunction({ ...user, permissionsConfigured: true }, "dashboard.personal.values.read")).toBe(true);
    expect(canUseLocalFunction({ ...user, permissionsConfigured: true, connectFunctions: [] }, "dashboard.personal.values.read")).toBe(false);
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
