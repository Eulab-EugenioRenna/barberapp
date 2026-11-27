import { canAccessLocalView, canUseLocalFunction, VIEW_FUNCTIONS } from "@barber/shared/functions";
import type { Router, UrlTree } from "@angular/router";

/**
 * Pure route decision from the stored /auth/me profile: no network. The server
 * stays authoritative on every API call; this only chooses what to show.
 */
export function routeDecision(user: any, url: string, router: Pick<Router, "createUrlTree">): true | UrlTree {
  const path = url.split("?")[0];
  if (path === "/account" && user.role !== "platform_admin")
    return user.technicalAccess ? router.createUrlTree(["/access-unavailable"]) : true;
  const selectedProfile = new URLSearchParams(url.split("?")[1] || "").get("collaboratorId");
  const teamAgenda = path === "/my-agenda" && !!selectedProfile;
  if (teamAgenda && !canUseLocalFunction(user, "appointments.read.all")) return router.createUrlTree(["/access-unavailable"]);
  if (user.role === "collaborator") {
    const destination = canUseLocalFunction(user, "appointments.read.own") ? "/my-agenda" : "/access-unavailable";
    return path === destination ? true : router.createUrlTree([destination]);
  }
  if (user.role === "platform_admin")
    return url.startsWith("/platform") ? true : router.createUrlTree(["/platform"]);
  if (url.startsWith("/my-agenda") && !teamAgenda && (!user.collaboratorId || !canUseLocalFunction(user, "appointments.read.own")))
    return router.createUrlTree(["/access-unavailable"]);
  const view = path.split("/")[1];
  const required = VIEW_FUNCTIONS[view];
  if (required && !canAccessLocalView(user, view)) {
    const first = Object.entries(VIEW_FUNCTIONS).find(([view]) => canAccessLocalView(user, view));
    return router.createUrlTree([
      first ? `/${first[0]}` : user.collaboratorId && canUseLocalFunction(user, "appointments.read.own") ? "/my-agenda" : "/access-unavailable",
    ]);
  }
  if (view === "platform") return router.createUrlTree(["/access-unavailable"]);
  return true;
}

/** What changes the routes or the menu: a difference re-runs the decision. */
export function accessFingerprint(user: any): string {
  return JSON.stringify([
    user?.id,
    user?.role,
    user?.tenantId,
    user?.collaboratorId ?? null,
    !!user?.technicalAccess,
    !!user?.permissionsConfigured,
    [...(user?.permissions ?? [])].sort(),
    [...(user?.connectFunctions ?? [])].sort(),
  ]);
}
