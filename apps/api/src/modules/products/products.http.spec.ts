import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { APP_GUARD } from "@nestjs/core";
import { Prisma } from "@prisma/client";
import { ProductsController } from "./products.controller";
import { PrismaService } from "../../prisma/prisma.service";
import { PricingService } from "../pricing/pricing.service";
import { AppCacheService } from "../../cache/cache.service";
import { CacheInvalidationService } from "../../cache/cache-invalidation.service";
import { LocalPolicyGuard } from "../../common/local-policy.guard";

jest.mock("../../common/request-session", () => {
  const actual = jest.requireActual("../../common/request-session");
  return {
    ...actual,
    resolveRequestSession: jest.fn(async (_prisma, authorization: string) => ({
      tenantId: authorization === "Bearer other" ? "tenant-b" : "tenant-a",
      user: {
        id: "fixture",
        role: authorization === "Bearer denied" ? "reception" : "owner",
        permissions: [],
      },
    })),
  };
});

describe("products HTTP barcode contract with LocalPolicyGuard", () => {
  let app: INestApplication;
  let url: string;
  const product = {
    findFirst: jest.fn(async ({ where }) =>
      where.tenantId === "tenant-a" && where.barcode === "4006381333931"
        ? { id: "product-a", ...where }
        : null,
    ),
    create: jest
      .fn()
      .mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("duplicate", {
          code: "P2002",
          clientVersion: "5.22.0",
          meta: { target: ["tenantId", "barcode"] },
        }),
      ),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: PrismaService, useValue: { product } },
        {
          provide: PricingService,
          useValue: {
            data: () => ({}),
            write: (
              _tenant: string,
              _actor: string,
              _reason: unknown,
              write: (tx: unknown) => unknown,
            ) => write({ product }),
          },
        },
        { provide: AppCacheService, useValue: {} },
        { provide: CacheInvalidationService, useValue: {} },
        { provide: APP_GUARD, useClass: LocalPolicyGuard },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, "127.0.0.1");
    url = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
  });

  it("routes GET by-barcode and returns a normalized tenant product", async () => {
    const response = await fetch(
      `${url}/products/by-barcode?barcode=${encodeURIComponent(" 400 6381 333931 ")}`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "product-a",
      tenantId: "tenant-a",
      barcode: "4006381333931",
    });
  });
  it.each(["MISSING", "4006381333931"])(
    "returns 404 for code %s in another tenant even with a forged tenantId query",
    async (barcode) => {
      const response = await fetch(
        `${url}/products/by-barcode?barcode=${barcode}&tenantId=tenant-a`,
        { headers: { authorization: "Bearer other" } },
      );
      expect(response.status).toBe(404);
    },
  );
  it("returns 400 for a blank barcode", async () => {
    expect(
      (await fetch(`${url}/products/by-barcode?barcode=%20%20`)).status,
    ).toBe(400);
  });
  it.each(["GET", "POST"])(
    "denies %s without the corresponding product permission",
    async (method) => {
      const response = await fetch(
        `${url}/products${method === "GET" ? "/by-barcode?barcode=4006381333931" : ""}`,
        {
          method,
          headers: {
            authorization: "Bearer denied",
            "content-type": "application/json",
          },
          ...(method === "POST"
            ? { body: JSON.stringify({ barcode: "4006381333931" }) }
            : {}),
        },
      );
      expect(response.status).toBe(403);
      expect(product.create).not.toHaveBeenCalled();
    },
  );
  it("returns a UI-usable 409 response for a duplicate tenant barcode", async () => {
    const response = await fetch(`${url}/products`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Fixture", barcode: "4006381333931" }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      message: "Barcode già assegnato a un altro prodotto di questa attività",
    });
  });
});
