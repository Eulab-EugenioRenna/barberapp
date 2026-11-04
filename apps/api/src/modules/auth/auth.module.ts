import { ConnectAuthController } from "./connect-auth.controller";
import { ConnectAuthService } from "./connect-auth.service";
import { ConnectTechnicalController } from "./connect-technical.controller";
import { ConnectTechnicalService } from "./connect-technical.service";
import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";

@Module({
  imports: [],
  controllers: [
    AuthController,
    ConnectAuthController,
    ConnectTechnicalController,
  ],
  providers: [ConnectAuthService, ConnectTechnicalService],
})
export class AuthModule {}
