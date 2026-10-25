import { Module } from "@nestjs/common";
import { TeamController } from "./team.controller";
import { TeamLocalPolicyService } from "./team-local-policy.service";
import { TeamService } from "./team.service";
@Module({ controllers: [TeamController], providers: [TeamService, TeamLocalPolicyService] })
export class TeamModule {}
