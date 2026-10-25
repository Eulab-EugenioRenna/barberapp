import { connectApplication } from "../../common/connect-application";
import type { ConnectApplication } from "@eulab/connect/application";
import { PrismaService } from "../../prisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import { FunctionCatalogController } from "./function-catalog.controller";
jest.mock("../../common/connect-application", () => ({ connectApplication: jest.fn() }));
describe("public function matrix", () => {
  const original = { ...process.env };
  beforeEach(() => { delete process.env["ALORA_CONNECT_APP_ID"]; delete process.env["ALORA_CONNECT_PRESENTER_ID"]; jest.clearAllMocks(); });
  afterEach(() => { process.env = { ...original }; });
  it("uses the SDK-approved identity in presenter mode without touching a real service", async () => {
    const sync = jest.fn(async () => ({ status: "ready", appId: "approved-app" }));
    jest.mocked(connectApplication).mockResolvedValue({ configuration: { sync }, catalog: { appId: "approved-app" } } as unknown as ConnectApplication);
    const matrix = await new FunctionCatalogController(new ConfigService({ ALORA_CONNECT_APP_ID: "proposed-app", ALORA_CONNECT_PRESENTER_ID: "fixture" }), {} as PrismaService).matrix();
    expect(matrix.appId).toBe("approved-app");expect(sync).toHaveBeenCalledTimes(1);
  });
  it("requires a server configured application identity", async () => {
    await expect(
      new FunctionCatalogController(
        new ConfigService({}),
        {} as PrismaService,
      ).matrix(),
    ).rejects.toThrow("Identità applicazione Connect non configurata");
    expect(
      (
        await new FunctionCatalogController(
          new ConfigService({ ALORA_CONNECT_APP_ID: "alora-isolated" }),
          {} as PrismaService,
        ).matrix()
      ).appId,
    ).toBe("alora-isolated");
  });
});
