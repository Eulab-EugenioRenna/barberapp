import { Prisma } from "@prisma/client";
import { ProductsController } from "./products.controller";

jest.mock("../../common/request-session", () => ({
  resolveRequestSession: jest
    .fn()
    .mockResolvedValue({
      tenantId: "tenant-a",
      user: { id: "owner", role: "owner" },
    }),
  requireTenantId: (session: { tenantId: string }) => session.tenantId,
  requireUser: (session: { user: unknown }) => session.user,
}));

const request = { headers: { authorization: "Bearer fixture" } };
function fixture() {
  const rows = [
    { id: "a", tenantId: "tenant-a", barcode: "4006381333931" },
    { id: "b", tenantId: "tenant-b", barcode: "FOREIGN" },
  ];
  const product = {
    findFirst: jest.fn(
      async ({ where }) =>
        rows.find((row) =>
          Object.entries(where).every(
            ([key, value]) => row[key as keyof typeof row] === value,
          ),
        ) ?? null,
    ),
    create: jest.fn(async ({ data }) => data),
    update: jest.fn(async ({ data }) => data),
  };
  const pricing = {
    data: jest.fn().mockReturnValue({}),
    write: jest.fn((_tenant, _actor, _reason, write) => write({ product })),
  };
  const invalidation = {
    invalidateProducts: jest.fn(),
    invalidatePublicServices: jest.fn(),
    invalidateDashboard: jest.fn(),
  };
  const controller = new ProductsController(
    pricing as never,
    { product } as never,
    {} as never,
    invalidation as never,
  );
  return { product, controller, invalidation };
}

describe("ProductsController barcode", () => {
  it("finds a normalized barcode within the session tenant", async () => {
    const { controller, product } = fixture();
    await expect(
      controller.byBarcode(request, { barcode: " 400 6381 333931 \n" }),
    ).resolves.toMatchObject({ id: "a" });
    expect(product.findFirst).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", barcode: "4006381333931" },
    });
  });
  it.each(["MISSING", "FOREIGN"])(
    "returns 404 for missing or other-tenant code %s",
    async (barcode) => {
      await expect(
        fixture().controller.byBarcode(request, { barcode }),
      ).rejects.toMatchObject({ status: 404 });
    },
  );
  it.each([undefined, "", " \t "])(
    "rejects empty lookup %s before querying products",
    async (barcode) => {
      const { controller, product } = fixture();
      await expect(
        controller.byBarcode(request, { barcode }),
      ).rejects.toMatchObject({ status: 400 });
      expect(product.findFirst).not.toHaveBeenCalled();
    },
  );
  it.each(["create", "update"] as const)(
    "%s normalizes stored barcodes and invalidates product lists",
    async (operation) => {
      const { controller, product, invalidation } = fixture();
      const body = { name: "Fixture", barcode: " 400 6381 333931 " };
      const result =
        operation === "create"
          ? await controller.create(request, body)
          : await controller.update(request, "a", body);
      expect(result).toMatchObject({ barcode: "4006381333931" });
      expect(product[operation]).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ barcode: "4006381333931" }),
        }),
      );
      expect(invalidation.invalidateProducts).toHaveBeenCalledWith("tenant-a");
    },
  );
  it.each(["create", "update"] as const)(
    "%s reports a usable 409 for a tenant barcode collision",
    async (operation) => {
      const { controller, product, invalidation } = fixture();
      product[operation].mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("duplicate", {
          code: "P2002",
          clientVersion: "5.22.0",
          meta: { target: ["tenantId", "barcode"] },
        }),
      );
      const promise =
        operation === "create"
          ? controller.create(request, { barcode: "4006381333931" })
          : controller.update(request, "a", { barcode: "4006381333931" });
      await expect(promise).rejects.toMatchObject({
        status: 409,
        message: "Barcode già assegnato a un altro prodotto di questa attività",
      });
      expect(invalidation.invalidateProducts).not.toHaveBeenCalled();
    },
  );
  it.each(["", " \t ", null])(
    "clears the barcode with %s using NULL",
    async (barcode) => {
      await expect(
        fixture().controller.update(request, "a", { barcode } as never),
      ).resolves.toMatchObject({ barcode: null });
    },
  );
  it("preserves the barcode when omitted from a patch", async () => {
    const { controller, product } = fixture();
    await controller.update(request, "a", { name: "Renamed" });
    expect(product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "a", tenantId: "tenant-a" },
        data: expect.objectContaining({ barcode: undefined }),
      }),
    );
  });
});
