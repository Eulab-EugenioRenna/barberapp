import { Routes } from "@angular/router";
import { authGuard } from "./core/auth.guard";
import { AccessUnavailableComponent } from "./pages/access-unavailable.component";
import { AdminAuthPageComponent } from "./pages/admin-auth-page.component";
import { AdminShellComponent } from "./shell/admin-shell.component";

// Pages load on first visit: login and the frame do not wait for every screen's code.
const adminApp = () => import("./admin-app.component").then((m) => m.AdminAppComponent);

const shellView = (path: string, view: string) => ({
  path,
  loadComponent: adminApp,
  canActivate: [authGuard],
  data: { view },
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
