import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { AuthController } from "./auth.controller";

@Module({
  imports: [NotificationsModule],
  controllers: [AuthController],
})
export class AuthModule {}
