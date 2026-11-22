import { Prisma } from "@prisma/client";
import { SaleFulfilmentService } from "./sale-fulfilment.service";

const row = (id: string, duration: number) => ({
  id,
  serviceId: "svc-" + id,
  sectorId: "sec1",
  collaboratorId: "c1",
  quantity: 1,
  lineTotal: new Prisma.Decimal(20),
  taxTotal: new Prisma.Decimal(0),
  nonPerformanceChargeReason: null,
  service: { durationMinutes: duration, requiresCollaborator: true },
  booking: null,
});

describe("services sold at the till go in the agenda", () => {
  const created: any[] = [];
  const tx: any = {
    sale: {
      findUniqueOrThrow: jest.fn(async () => ({
        id: "sale-1",
        tenantId: "t1",
        locationId: "l1",
        customerId: "cust-1",
        appointmentId: null,
        orderStatus: "confirmed",
        soldAt: new Date("2026-11-22T15:00:00.000Z"),
        items: [row("a", 30), row("b", 15)],
      })),
      update: jest.fn(),
    },
    appointment: {
      create: jest.fn(async ({ data }: any) => {
        created.push(data);
        return { id: "appt-" + created.length };
      }),
      update: jest.fn(),
    },
  };

  beforeEach(() => {
    created.length = 0;
    jest.clearAllMocks();
  });

  it("starts at the chosen past time, one service after the other, as completed", async () => {
    await new SaleFulfilmentService().confirm(tx, "sale-1", "u1", {
      orderStatus: "new",
      items: [],
      rowOrder: ["a", "b"],
      servicesStartAt: new Date("2026-11-10T09:00:00.000Z"),
    });
    expect(created.map((a) => [a.startsAt.toISOString(), a.endsAt.toISOString(), a.status])).toEqual([
      ["2026-11-10T09:00:00.000Z", "2026-11-10T09:30:00.000Z", "completed"],
      ["2026-11-10T09:30:00.000Z", "2026-11-10T09:45:00.000Z", "completed"],
    ]);
    expect(tx.sale.update).toHaveBeenCalledWith({ where: { id: "sale-1" }, data: { appointmentId: "appt-1" } });
  });

  it("without a chosen time the services end at the sale time", async () => {
    await new SaleFulfilmentService().confirm(tx, "sale-1", "u1", {
      orderStatus: "new",
      items: [],
      rowOrder: ["a", "b"],
    });
    expect(created[0].startsAt.toISOString()).toBe("2026-11-22T14:15:00.000Z");
    expect(created[1].endsAt.toISOString()).toBe("2026-11-22T15:00:00.000Z");
  });
});
