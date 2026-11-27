import { Route, Routes } from "@angular/router";
import { authGuard } from "./core/auth.guard";
import { AccessUnavailableComponent } from "./pages/access-unavailable.component";
import { AdminAuthPageComponent } from "./pages/admin-auth-page.component";
import { AdminShellComponent } from "./shell/admin-shell.component";
import { WORKSPACE_VIEW } from "./core/admin-route-reuse.strategy";

// Pages load on first visit: login and the frame do not wait for every screen's code.
const adminApp = () => import("./admin-app.component").then((m) => m.AdminAppComponent);

// One component for all these views, kept alive across them (AdminRouteReuseStrategy);
// the guard still checks each view. `preload`: fetched when the browser is idle.
const shellView = (path: string, view: string): Route => ({
  path,
  loadComponent: adminApp,
  canActivate: [authGuard],
  runGuardsAndResolvers: "always",
  data: { view, [WORKSPACE_VIEW]: true, preload: true },
});

const page = (path: string, loadComponent: () => Promise<any>) => ({
  path,
  loadComponent,
  canActivate: [authGuard],
});

export const adminRoutes: Routes = [
  { path: "", pathMatch: "full", redirectTo: "login" },
  { path: "login", component: AdminAuthPageComponent },
  { path: "signup", component: AdminAuthPageComponent },
  {
    path: "access-unavailable",
    component: AccessUnavailableComponent,
    canActivate: [authGuard],
  },
  {
    // Every authenticated page shares one frame (navigation, scope, logout).
    path: "",
    component: AdminShellComponent,
    children: [
      shellView("dashboard", "dashboard"),
      shellView("appointments", "appointments"),
      // "Conti da chiudere" is now part of the till.
      { path: "confirmations", pathMatch: "full", redirectTo: "sales" },
      shellView("sales", "sales"),
      shellView("customers", "customers"),
      page("whatsapp", () => import("./pages/whatsapp.component").then((m) => m.WhatsAppComponent)),
      shellView("services", "services"),
      page("inventory", () => import("./pages/inventory.component").then((m) => m.InventoryComponent)),
      page("locations", () => import("./pages/locations.component").then((m) => m.LocationsComponent)),
      shellView("collaborators", "collaborators"),
      { path: "team", pathMatch: "full", redirectTo: "collaborators" },
      page("notifications", () =>
        import("./pages/notifications-settings.component").then((m) => m.NotificationsSettingsComponent),
      ),
      shellView("settings", "settings"),
      page("my-agenda", () => import("./pages/personal-agenda.component").then((m) => m.PersonalAgendaComponent)),
      page("account", () => import("./pages/personal-account.component").then((m) => m.PersonalAccountComponent)),
      shellView("platform", "platform"),
    ],
  },
  { path: "**", redirectTo: "login" },
];
