import { ConnectAuthController } from "./connect-auth.controller";
import { ConnectAuthService } from "./connect-auth.service";
import { ConnectTechnicalController } from "./connect-technical.controller";
import { ConnectTechnicalService } from "./connect-technical.service";
import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { PersonalAccountController } from "./personal-account.controller";
import { PersonalAccountService } from "./personal-account.service";

@Module({
  imports: [],
  controllers: [
    AuthController,
    PersonalAccountController,
    ConnectAuthController,
    ConnectTechnicalController,
  ],
  providers: [ConnectAuthService, ConnectTechnicalService, PersonalAccountService],
})
export class AuthModule {}
