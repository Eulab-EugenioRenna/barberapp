import { PrismaService } from "../../prisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import { FunctionCatalogController } from "./function-catalog.controller";
describe("public function matrix", () => {
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
