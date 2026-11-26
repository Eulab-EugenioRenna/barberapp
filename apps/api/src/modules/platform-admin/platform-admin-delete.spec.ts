import { ConflictException, NotFoundException } from "@nestjs/common";
import { PlatformAdminService, TENANT_RESET_KEEP } from "./platform-admin.service";

/** SQL sent through the tagged templates, with its values, in order. */
function setup(stillThere = false) {
  const sql: Array<{ text: string; values: unknown[] }> = [];
  const record = (strings: TemplateStringsArray, ...values: unknown[]) => { sql.push({ text: strings.join("?"), values }); return Promise.resolve([]); };
  const tx = { $queryRaw: jest.fn(record), $executeRaw: jest.fn(record) };
  let lookups = 0;
  const prisma: any = {
    tenant: { findUnique: jest.fn(async () => (lookups++ === 0 || stillThere ? { id: "t1" } : null)) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const invalidation: any = new Proxy({}, { get: () => jest.fn(async () => undefined) });
  const service = new PlatformAdminService(prisma, {} as any, invalidation);
  return { service, prisma, sql };
}

describe("Elimina attività", () => {
  it("removes every record of the tenant and the tenant, in one transaction", async () => {
    const { service, prisma, sql } = setup();
    await expect(service.deleteTenant("t1")).resolves.toEqual({ id: "t1", removed: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(sql.map((s) => s.text)).toEqual([
      "SELECT alora_purge_tenant(?)::text AS removed",
      'DELETE FROM "Tenant" WHERE id = ?',
    ]);
    expect(sql.every((s) => s.values[0] === "t1")).toBe(true);
  });

  it("says so when the database did not remove it", async () => {
    const { service } = setup(true);
    await expect(service.deleteTenant("t1")).rejects.toBeInstanceOf(ConflictException);
  });

  it("an unknown tenant is not found", async () => {
    const { service, prisma } = setup();
    prisma.tenant.findUnique.mockResolvedValueOnce(null);
    await expect(service.deleteTenant("x")).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("«Azzera dati» keeps accounts, structure and WhatsApp history", async () => {
    const { service, sql } = setup();
    jest.spyOn(service as any, "healthCheck").mockResolvedValue({ ok: true });
    await service.resetTenantData("t1");
    expect(sql[0].text).toBe("SELECT alora_purge_tenant(?, ?::text[])::text AS removed");
    expect(sql[0].values).toEqual(["t1", TENANT_RESET_KEEP]);
    for (const table of ["User", "TenantSubscription", "Location", "Sector", "WhatsAppSend"]) expect(TENANT_RESET_KEEP).toContain(table);
    for (const table of ["Sale", "Customer", "Appointment", "PaymentEntry"]) expect(TENANT_RESET_KEEP).not.toContain(table);
  });
});
