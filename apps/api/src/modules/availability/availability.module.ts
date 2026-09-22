import { Module } from "@nestjs/common";
import { AvailabilityController } from "./availability.controller";
import { AvailabilityService } from "./availability.service";
import { CollaboratorScheduleService } from "./collaborator-schedule.service";

@Module({
  controllers: [AvailabilityController],
  providers: [AvailabilityService, CollaboratorScheduleService],
  exports: [AvailabilityService, CollaboratorScheduleService],
})
export class AvailabilityModule {}
