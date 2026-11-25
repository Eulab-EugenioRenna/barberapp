import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { APP_GUARD } from "@nestjs/core";
import { CatalogOrderController } from "./catalog-order.controller";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheInvalidationService } from "../../cache/cache-invalidation.service";
import { LocalPolicyGuard } from "../../common/local-policy.guard";

jest.mock("../../common/request-session", () => {
  const actual = jest.requireActual("../../common/request-session");
  return {
    ...actual,
    resolveRequestSession: jest.fn(async (_prisma, authorization: string) => ({
      tenantId: "tenant-a",
      user: {
        id: "fixture",
        role: authorization === "Bearer denied" ? "reception" : "owner",
        permissions: [],
      },
    })),
  };
});

describe("POST /catalog-order", () => {
  let app: INestApplication;
  let url: string;
  const service = { updateMany: jest.fn(async () => ({ count: 1 })) };
  const product = { updateMany: jest.fn(async () => ({ count: 1 })) };
  const cache = {
    invalidateServices: jest.fn(async () => undefined),
    invalidateProducts: jest.fn(async () => undefined),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CatalogOrderController],
      providers: [
        {
          provide: PrismaService,
          useValue: {
            service,
            product,
            $transaction: (writes: Promise<unknown>[]) => Promise.all(writes),
          },
        },
        { provide: CacheInvalidationService, useValue: cache },
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
  const send = (body: unknown, authorization = "Bearer owner") =>
    fetch(`${url}/catalog-order`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization },
      body: JSON.stringify(body),
    });

  it("saves the grid position of services and products in this account only", async () => {
    const response = await send({
      items: [
        { kind: "product", id: "p1" },
        { kind: "service", id: "s1" },
      ],
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ saved: 2 });
    expect(product.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", tenantId: "tenant-a" },
      data: { sortOrder: 0 },
    });
    expect(service.updateMany).toHaveBeenCalledWith({
      where: { id: "s1", tenantId: "tenant-a" },
      data: { sortOrder: 1 },
    });
    expect(cache.invalidateServices).toHaveBeenCalledWith("tenant-a");
    expect(cache.invalidateProducts).toHaveBeenCalledWith("tenant-a");
  });
  it("rejects unknown kinds", async () => {
    expect((await send({ items: [{ kind: "room", id: "r1" }] })).status).toBe(
      400,
    );
  });
  it("needs catalogue management", async () => {
    expect((await send({ items: [] }, "Bearer denied")).status).toBe(403);
  });
});
