import { ConnectAuthController } from "./connect-auth.controller";
import { ConnectAuthService } from "./connect-auth.service";
import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";

@Module({
  imports: [],
  controllers: [AuthController, ConnectAuthController],
  providers: [ConnectAuthService],
})
export class AuthModule {}
