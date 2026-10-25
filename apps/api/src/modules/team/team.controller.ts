import { Body, Controller, Delete, Get, Param, Post, Put, Req } from "@nestjs/common";
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsString, IsUUID, Length } from "class-validator";
import { ALORA_FUNCTIONS } from "../../common/function-catalog";
import { TeamService } from "./team.service";

class RoleDto {
  @IsString() @Length(1, 120) name!: string;
  @IsArray() @ArrayMaxSize(100) @ArrayUnique()
  @IsIn(ALORA_FUNCTIONS.map(item => item.key), { each: true }) permissions!: string[];
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
  constructor(private readonly team: TeamService) {}
  @Get() overview(@Req() request: TeamRequest) { return this.team.overview(request.headers.authorization); }
  @Post("roles") createRole(@Req() request: TeamRequest, @Body() body: RoleDto) { return this.team.createRole(request.headers.authorization, body); }
  @Put("roles/:id") updateRole(@Req() request: TeamRequest, @Param() params: IdentifierDto, @Body() body: RoleDto) { return this.team.updateRole(request.headers.authorization, params.id, body); }
  @Delete("roles/:id") removeRole(@Req() request: TeamRequest, @Param() params: IdentifierDto) { return this.team.removeRole(request.headers.authorization, params.id); }
  @Put("users/:id/roles") assignRoles(@Req() request: TeamRequest, @Param() params: IdentifierDto, @Body() body: AssignmentDto) { return this.team.assignRoles(request.headers.authorization, params.id, body.roleIds); }
  @Delete("users/:id/access") revoke(@Req() request: TeamRequest, @Param() params: IdentifierDto) { return this.team.revoke(request.headers.authorization, params.id); }
  @Post("users/:id/restore") restore(@Req() request: TeamRequest, @Param() params: IdentifierDto) { return this.team.restore(request.headers.authorization, params.id); }
}
