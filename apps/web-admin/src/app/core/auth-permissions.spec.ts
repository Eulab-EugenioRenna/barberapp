import { of } from "rxjs";
const providers = new Map<unknown, unknown>();
jest.mock("@angular/core", () => ({Injectable: () => (target: unknown) => target, inject: (token: unknown) => providers.get(token)}));
jest.mock("@angular/common/http", () => ({HttpClient: class {}}));
jest.mock("@angular/router", () => ({Router: class {}}));
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from "@angular/router";
import { AuthApiService } from "./auth-api.service";
import { SessionStore } from "./session.store";
import { authGuard } from "./auth.guard";

describe("function-based route access", () => {
  async function visit(role: string, permissions: string[], url: string) {
    const user = {role,permissions,collaboratorId:"c1"};
    const clear = jest.fn();
    providers.set(SessionStore, {isAuthenticated:()=>true,currentUser:()=>user,setCurrentUser:jest.fn(),clear});
    providers.set(AuthApiService, {me:()=>of(user)});
    providers.set(Router, {createUrlTree:(paths: string[])=>paths[0]});
    const result=await authGuard({} as ActivatedRouteSnapshot,{url} as RouterStateSnapshot);
    expect(clear).not.toHaveBeenCalled();
    return result;
  }
  it("redirects a manager to their first permitted section", async()=>{
    expect(await visit("manager",["appointments.read.all"],"/dashboard")).toBe("/appointments");
    expect(await visit("manager",["appointments.read.all"],"/appointments")).toBe(true);
  });
  it("admits products-only access and handles accounts with no enabled section",async()=>{
    expect(await visit("reception",["products.read"],"/services")).toBe(true);
    expect(await visit("reception",[],"/dashboard")).toBe("/access-unavailable");
  });
  it("protects the team page with the local users capability", async()=>{
    expect(await visit("manager",["users.manage"],"/team")).toBe(true);
    expect(await visit("manager",["appointments.read.all"],"/team")).toBe("/appointments");
  });
  it("re-reads local restrictions and routes explicit empty collaborator policy away from the agenda", async()=>{
    const user = { role: "collaborator", permissions: [], permissionsConfigured: true, collaboratorId: "c1" };
    providers.set(SessionStore, { isAuthenticated:()=>true, currentUser:()=>({ ...user, permissionsConfigured: false }), setCurrentUser:jest.fn(), clear:jest.fn() });
    const me = jest.fn(()=>of(user));providers.set(AuthApiService, { me });
    providers.set(Router, { createUrlTree:(paths:string[])=>paths[0] });
    expect(await authGuard({} as ActivatedRouteSnapshot,{url:"/my-agenda"} as RouterStateSnapshot)).toBe("/access-unavailable");
    expect(await authGuard({} as ActivatedRouteSnapshot,{url:"/access-unavailable"} as RouterStateSnapshot)).toBe(true);
    expect(me).toHaveBeenCalledTimes(2);
  });
  it("supports personal-only scopes for custom operational roles", async()=>{
    expect(await visit("manager",["appointments.read.own"],"/my-agenda")).toBe(true);
    expect(await visit("reception",["appointments.read.own"],"/dashboard")).toBe("/my-agenda");
  });
  it("keeps platform and personal routes separate", async()=>{
    expect(await visit("platform_admin",[],"/dashboard")).toBe("/platform");
    expect(await visit("collaborator",["dashboard.revenue.read"],"/dashboard")).toBe("/my-agenda");
    expect(await visit("manager",[],"/my-agenda")).toBe("/access-unavailable");
  });
});
