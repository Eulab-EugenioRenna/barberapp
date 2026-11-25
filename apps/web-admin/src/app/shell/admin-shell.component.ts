import { CommonModule } from "@angular/common";
import { Component, OnInit, computed, effect, inject, signal } from "@angular/core";
import { NavigationEnd, Router, RouterOutlet } from "@angular/router";
import { filter } from "rxjs";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import {
  UiAppShellComponent,
  UiBottomNavComponent,
  UiBreakpointService,
  UiIconComponent,
  UiSideNavComponent,
} from "@alora/ui";
import { AloraBrandComponent } from "@barber/shared/brand";
import { hasAllLocalFunctions } from "@barber/shared/functions";
import {
  buildMobileItems,
  buildNavGroups,
  navKeyFromUrl,
  type AdminNavKey,
} from "../core/admin-navigation";
import { AdminFacade } from "../core/admin.facade";
import { ADMIN_API_URL } from "../core/api-config";
import { AppointmentOrderNotificationsService } from "../core/appointment-order-notifications.service";
import { SessionStore } from "../core/session.store";
import { AdminPwaBannerComponent } from "../shared/admin-pwa-banner.component";
import { OperationalSelectorComponent } from "../shared/operational-selector.component";
import { OperationalContextService } from "../core/operational-context.service";
import { TourOverlayComponent } from "../shared/tour-overlay.component";
import { TourService } from "../core/onboarding/tour.service";

const COLLAPSED_KEY = "alora.sidebar-collapsed";
/** Views rendered by AdminAppComponent, which loads the tenant itself. */
const SELF_LOADING_VIEWS: ReadonlySet<AdminNavKey> = new Set([
  "dashboard",
  "appointments",
  "sales",
  "customers",
  "services",
  "collaborators",
  "settings",
  "platform",
]);

/**
 * Frame shared by every authenticated page: navigation, operational scope and
 * logout live here once, pages only render their own content.
 */
@Component({
  selector: "alora-admin-shell",
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    UiAppShellComponent,
    UiSideNavComponent,
    UiBottomNavComponent,
    UiIconComponent,
    AloraBrandComponent,
    OperationalSelectorComponent,
    AdminPwaBannerComponent,
    TourOverlayComponent,
  ],
  template: `<ui-app-shell
    [rail]="rail()"
    [drawerOpen]="drawerOpen()"
    (drawerOpenChange)="drawerOpen.set($event)"
  >
    <div uiShellSidebar class="sb" [class.sb-rail]="rail()">
      <div class="sb-header">
        <div *ngIf="!rail()" class="sb-identity">
          <alora-brand [onDark]="true" [pro]="isPro()"></alora-brand>
          <img
            *ngIf="tenantLogo()"
            [src]="tenantLogo()"
            alt=""
            class="sb-logo"
          />
          <p class="sb-tenant">{{ tenantName() }}</p>
        </div>
        <button
          *ngIf="!breakpoints.isMobile()"
          type="button"
          class="sb-icon-btn"
          data-tour="shell-rail"
          [attr.aria-label]="rail() ? 'Espandi menu' : 'Comprimi menu'"
          [attr.aria-expanded]="!rail()"
          (click)="toggleRail()"
        >
          <ui-icon [name]="rail() ? 'chevron-right' : 'chevron-left'"></ui-icon>
        </button>
        <button
          *ngIf="breakpoints.isMobile()"
          type="button"
          class="sb-icon-btn"
          aria-label="Chiudi menu"
          (click)="drawerOpen.set(false)"
        >
          <ui-icon name="close"></ui-icon>
        </button>
      </div>

      <div class="sb-nav" data-tour="shell-nav">
        <ui-side-nav
          [groups]="groups()"
          [activeKey]="activeKey()"
          [collapsed]="rail()"
          (select)="go($event)"
        ></ui-side-nav>
      </div>

      <button
        type="button"
        class="sb-logout"
        data-tour="shell-logout"
        [attr.aria-label]="rail() ? 'Esci' : null"
        [attr.title]="rail() ? 'Esci' : null"
        (click)="logout()"
      >
        <ui-icon name="logout"></ui-icon>
        <span *ngIf="!rail()">Esci</span>
      </button>
    </div>

    <div uiShellTopbar *ngIf="showTopbar()" class="topbar-stack">
      <barber-admin-pwa-banner></barber-admin-pwa-banner>
      <!-- Kept in the DOM (it loads the locations); shown only when there is a choice.
           The Panoramica puts it in its own title row. -->
      <alora-operational-selector
        *ngIf="showScope()"
        [class.scope-hidden]="!scopeVisible()"
        data-tour="shell-scope"
      ></alora-operational-selector>
    </div>

    <router-outlet></router-outlet>

    <ui-bottom-nav
      uiShellBottomNav
      *ngIf="user()"
      [items]="mobileItems()"
      [activeKey]="activeKey()"
      [moreActive]="moreActive()"
      (select)="go($event)"
      (more)="drawerOpen.set(true)"
    ></ui-bottom-nav>
  </ui-app-shell>
  <alora-tour-overlay></alora-tour-overlay>`,
  styles: [
    `
      :host {
        display: block;
        --ui-icon-size: 1.1rem;
      }
      .sb {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        height: 100%;
        min-height: 0;
      }
      .sb-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.75rem;
      }
      .sb-rail .sb-header {
        justify-content: center;
      }
      .sb-identity {
        display: grid;
        gap: 0.6rem;
        min-width: 0;
      }
      .sb-logo {
        max-width: 12rem;
        max-height: 3.5rem;
        object-fit: contain;
        object-position: left;
      }
      .sb-tenant {
        margin: 0;
        font-family: var(--font-display);
        font-size: 1.2rem;
        font-weight: 600;
        line-height: 1.2;
        overflow-wrap: anywhere;
      }
      .sb-icon-btn {
        display: inline-grid;
        place-items: center;
        flex: 0 0 auto;
        width: 2.5rem;
        height: 2.5rem;
        border: 0;
        border-radius: 999rem;
        background: rgba(255, 255, 255, 0.12);
        color: #fff;
        cursor: pointer;
        transition: 180ms ease;
      }
      .sb-icon-btn:hover {
        background: rgba(255, 255, 255, 0.2);
      }
      .sb-nav {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding-right: 0.125rem;
      }
      .sb-logout {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.6rem;
        min-height: 2.75rem;
        border: 0;
        border-radius: 999rem;
        background: rgba(255, 255, 255, 0.12);
        padding: 0.6rem 1rem;
        color: #fff;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
        transition: 180ms ease;
      }
      .sb-logout:hover {
        background: rgba(255, 255, 255, 0.2);
      }
      .sb-rail .sb-logout {
        width: 2.75rem;
        align-self: center;
        padding: 0;
      }
      .sb-icon-btn:focus-visible,
      .sb-logout:focus-visible {
        outline: 0.1875rem solid var(--alora-lime);
        outline-offset: 0.125rem;
      }
      .scope-hidden {
        display: none;
      }
      .topbar-stack {
        display: grid;
        gap: 0.65rem;
      }
    `,
  ],
})
export class AdminShellComponent implements OnInit {
  readonly breakpoints = inject(UiBreakpointService);
  private readonly session = inject(SessionStore);
  private readonly facade = inject(AdminFacade);
  private readonly orderAlerts = inject(AppointmentOrderNotificationsService);
  private readonly router = inject(Router);
  private readonly tour = inject(TourService);
  private readonly operational = inject(OperationalContextService);

  readonly drawerOpen = signal(false);
  private currentPath = this.router.url.split("?")[0];
  readonly activeKey = signal<AdminNavKey | null>(navKeyFromUrl(this.router.url));
  private readonly desktopCollapsed = signal(
    typeof localStorage !== "undefined" && localStorage.getItem(COLLAPSED_KEY) === "1",
  );
  private readonly tabletExpanded = signal(false);

  readonly user = computed(() => this.session.currentUser());
  private readonly badges = computed(() => ({
    sales: this.orderAlerts.appointments().length,
  }));
  readonly groups = computed(() => buildNavGroups(this.user(), this.badges()));
  readonly mobileItems = computed(() => buildMobileItems(this.user(), this.badges()));
  readonly moreActive = computed(
    () => !this.mobileItems().some((item) => item.key === this.activeKey()),
  );
  readonly rail = computed(() => {
    const viewport = this.breakpoints.viewport();
    if (viewport === "mobile") return false;
    if (viewport === "tablet") return !this.tabletExpanded();
    return this.desktopCollapsed();
  });
  readonly isPlatformAdmin = computed(() => this.user()?.role === "platform_admin");
  readonly isPro = computed(() => hasAllLocalFunctions(this.user()));
  readonly showScope = computed(() => !!this.user() && !this.isPlatformAdmin());
  readonly scopeVisible = computed(
    () =>
      this.operational.locations().length > 0 &&
      this.operational.hasChoice &&
      this.activeKey() !== "dashboard",
  );
  // The PWA banner renders nothing when not needed; the scope bar decides.
  readonly showTopbar = computed(() => this.showScope());
  readonly tenantName = computed(() =>
    this.isPlatformAdmin()
      ? "Gestione aziende"
      : (this.facade.tenant()?.publicTitle ?? this.facade.tenant()?.name ?? ""),
  );
  readonly tenantLogo = computed(() => {
    const path = this.facade.tenant()?.logoUrl;
    if (!path || this.isPlatformAdmin()) return "";
    return /^(https?:\/\/|data:|blob:)/i.test(path) ? path : `${ADMIN_API_URL}${path}`;
  });

  constructor() {
    // A session that ends while working (expiry, revocation, logout elsewhere)
    // must lead to the login, not to a page full of failing requests.
    effect(() => {
      if (this.session.token() || this.loggingOut) return;
      this.orderAlerts.stop();
      this.session.rememberRequestedUrl(this.router.url);
      void this.router.navigate(["/login"]);
    });
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        const path = event.urlAfterRedirects.split("?")[0];
        // Query-only updates (filters, selected item) keep the menu as it is.
        if (path !== this.currentPath) this.drawerOpen.set(false);
        this.currentPath = path;
        this.activeKey.set(navKeyFromUrl(event.urlAfterRedirects));
        // First visit of a page opens its guide (personalised per account).
        this.tour.scheduleAuto(this.activeKey());
      });
  }

  ngOnInit(): void {
    const key = this.activeKey();
    // Pages outside AdminAppComponent do not load the tenant: do it once here.
    if (
      !this.facade.tenant() &&
      this.user() &&
      !this.isPlatformAdmin() &&
      this.user()?.role !== "collaborator" &&
      !(key && SELF_LOADING_VIEWS.has(key))
    ) {
      void this.facade.refreshShell().catch(() => undefined);
    }
  }

  go(key: string): void {
    this.drawerOpen.set(false);
    void this.router.navigate([`/${key}`]);
  }

  toggleRail(): void {
    if (this.breakpoints.isTablet()) {
      this.tabletExpanded.update((value) => !value);
      return;
    }
    const next = !this.desktopCollapsed();
    this.desktopCollapsed.set(next);
    localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
  }

  private loggingOut = false;

  logout(): void {
    // Deliberate logout: do not reopen this page at the next login.
    this.loggingOut = true;
    this.facade.clearSession();
    this.orderAlerts.stop();
    void this.router.navigate(["/login"]);
  }
}
