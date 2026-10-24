import {
  Controller,
  Get,
  Header,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { connectApplication } from "../../common/connect-application";
import { ConfigService } from "@nestjs/config";
import { createFunctionMatrix } from "../../common/function-catalog";

@Controller(".well-known")
export class FunctionCatalogController {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("eulab-connect.json")
  @Header("Cache-Control", "no-cache")
  @Header("X-Content-Type-Options", "nosniff")
  async matrix(): Promise<ReturnType<typeof createFunctionMatrix>> {
    // Never infer identity from a request host, query or customer identifier.
    const appId = this.config.get<string>("ALORA_CONNECT_APP_ID");
    if (!appId)
      throw new ServiceUnavailableException(
        "Identità applicazione Connect non configurata",
      );
    if (this.config.get<string>("ALORA_CONNECT_PRESENTER_ID")) {
      const application = await connectApplication(this.prisma);
      await application.configuration.sync();
      return createFunctionMatrix(application.catalog.appId);
    }
    return createFunctionMatrix(appId);
  }
}
