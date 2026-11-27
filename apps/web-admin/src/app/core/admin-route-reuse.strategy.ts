import { Injectable } from "@angular/core";
import { ActivatedRouteSnapshot, BaseRouteReuseStrategy } from "@angular/router";

/** Route data flag of the views rendered by the one workspace component. */
export const WORKSPACE_VIEW = "workspaceView";

/**
 * Panoramica, Cassa, Clienti, Listino, Squadra, Profilo… are views of the same
 * AdminAppComponent. Moving between them keeps that component (and its data)
 * instead of destroying and rebuilding it: only the `view` in the route data
 * changes. Guards still run on every navigation (`runGuardsAndResolvers`).
 */
@Injectable()
export class AdminRouteReuseStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(future: ActivatedRouteSnapshot, current: ActivatedRouteSnapshot): boolean {
    return future.routeConfig === current.routeConfig || isWorkspacePair(future, current);
  }
}

export function isWorkspacePair(
  future: Pick<ActivatedRouteSnapshot, "routeConfig">,
  current: Pick<ActivatedRouteSnapshot, "routeConfig">,
): boolean {
  return !!future.routeConfig?.data?.[WORKSPACE_VIEW] && !!current.routeConfig?.data?.[WORKSPACE_VIEW];
}
