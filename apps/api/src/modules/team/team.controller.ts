import { Body, Controller, Delete, Get, Param, Post, Put, Req } from "@nestjs/common";
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsString, IsUUID, Length, IsOptional, ValidateIf } from "class-validator";
import { ALORA_FUNCTIONS } from "../../common/function-catalog";
import { TeamLocalPolicyService } from "./team-local-policy.service";
import { TeamService } from "./team.service";

class RoleDto {
  @IsString() @Length(1, 120) name!: string;
  @IsArray() @ArrayMaxSize(100) @ArrayUnique()
  @IsIn(ALORA_FUNCTIONS.map(item => item.key), { each: true }) permissions!: string[];
}
class LocalPolicyDto {
  @IsIn(["manager", "reception", "collaborator"]) role!: "manager" | "reception" | "collaborator";
  @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsIn(ALORA_FUNCTIONS.map(item => item.key), { each: true }) permissions!: string[];
  @IsOptional() @IsString() @Length(1, 250) collaboratorId?: string | null;
}
class SelfProfessionalDto {
  @ValidateIf((_object, value) => value !== null) @IsString() @Length(1, 250) collaboratorId!: string | null;
}
class AssignmentDto {
  @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID("all", { each: true }) roleIds!: string[];
}
class IdentifierDto {
  @IsString() @Length(1, 250) id!: string;
}
type TeamRequest = { headers: { authorization?: string } };

@Controller("team")
export class TeamController {
  constructor(private readonly team: TeamService, private readonly localPolicy: TeamLocalPolicyService) {}
  @Get("local-users") localUsers(@Req() request: TeamRequest) { return this.localPolicy.list(request.headers.authorization); }
  @Put("local-users/:id/policy") saveLocalPolicy(@Req() request: TeamRequest, @Param() params: IdentifierDto, @Body() body: LocalPolicyDto) { return this.localPolicy.save(request.headers.authorization, params.id, body); }
  @Put("me/professional") associateSelf(@Req() request: TeamRequest, @Body() body: SelfProfessionalDto) { return this.localPolicy.associateSelf(request.headers.authorization, body.collaboratorId); }
  @Get() overview(@Req() request: TeamRequest) { return this.team.overview(request.headers.authorization); }
  @Post("roles") createRole(@Req() request: TeamRequest, @Body() body: RoleDto) { return this.team.createRole(request.headers.authorization, body); }
  @Put("roles/:id") updateRole(@Req() request: TeamRequest, @Param() params: IdentifierDto, @Body() body: RoleDto) { return this.team.updateRole(request.headers.authorization, params.id, body); }
  @Delete("roles/:id") removeRole(@Req() request: TeamRequest, @Param() params: IdentifierDto) { return this.team.removeRole(request.headers.authorization, params.id); }
  @Put("users/:id/roles") assignRoles(@Req() request: TeamRequest, @Param() params: IdentifierDto, @Body() body: AssignmentDto) { return this.team.assignRoles(request.headers.authorization, params.id, body.roleIds); }
  @Delete("users/:id/access") revoke(@Req() request: TeamRequest, @Param() params: IdentifierDto) { return this.team.revoke(request.headers.authorization, params.id); }
  @Post("users/:id/restore") restore(@Req() request: TeamRequest, @Param() params: IdentifierDto) { return this.team.restore(request.headers.authorization, params.id); }
}
