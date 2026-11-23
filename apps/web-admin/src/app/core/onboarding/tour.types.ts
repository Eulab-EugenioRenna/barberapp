import type { AdminNavKey } from "../admin-navigation";

/**
 * What a tour knows about who is looking at it. Steps and texts are built
 * from this, so every account only sees the actions it can actually use.
 */
export interface TourContext {
  user: any;
  /** Role of the signed-in account (owner, manager, collaborator, platform_admin...). */
  role: string;
  /** First name to greet the user with, when known. */
  firstName: string;
  /** Tenant loaded in the shell, when available. */
  tenant: any;
  /** Local function enabled for this account (plan + role + permissions). */
  can: (functionKey: string) => boolean;
  /** Local view enabled for this account. */
  canView: (view: string) => boolean;
  /** Mobile layout (bottom bar instead of sidebar). */
  isMobile: boolean;
}

type Dynamic<T> = T | ((ctx: TourContext) => T);

export interface TourStep {
  /**
   * `data-tour` value(s) of the element to highlight; the first visible one
   * wins. Without a target the step is shown centred (intro / outro).
   */
  target?: string | readonly string[];
  /**
   * Key of the page tab (`data-tour="tab-{key}"`) the target lives in: the
   * tour switches to it before looking for the element. Inferred when the
   * target is the tab button itself.
   */
  tab?: string;
  title: Dynamic<string>;
  body: Dynamic<string>;
  /** Only shown when true for the current account (role, functions, tenant state). */
  when?: (ctx: TourContext) => boolean;
  /**
   * When the target is missing (hidden by permissions, empty list, not yet
   * configured) the step is skipped, unless a fallback text is given: then it
   * is shown centred with that explanation.
   */
  fallback?: Dynamic<string>;
}

export interface TourDefinition {
  id: string;
  /** Page the tour belongs to; `null` for the general tour of the shell. */
  navKey: AdminNavKey | null;
  title: string;
  /** Bumped when the steps change enough to show the tour again. */
  version: number;
  /** Tour available for this account at all. */
  when?: (ctx: TourContext) => boolean;
  steps: (ctx: TourContext) => readonly TourStep[];
}

/** A step resolved for the current account, ready to render. */
export interface ResolvedTourStep {
  targets: readonly string[];
  tab: string | null;
  title: string;
  body: string;
  fallback: string;
}

export function resolveDynamic<T>(value: Dynamic<T> | undefined, ctx: TourContext): T | undefined {
  return typeof value === "function" ? (value as (ctx: TourContext) => T)(ctx) : value;
}
