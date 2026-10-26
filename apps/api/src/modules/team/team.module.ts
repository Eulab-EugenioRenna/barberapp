import { Module } from "@nestjs/common";
import { TeamAccountService } from "./team-account.service";
import { TeamController } from "./team.controller";
import { TeamLocalPolicyService } from "./team-local-policy.service";
import { TeamService } from "./team.service";
@Module({ controllers: [TeamController], providers: [TeamService, TeamLocalPolicyService, TeamAccountService] })
export class TeamModule {}
