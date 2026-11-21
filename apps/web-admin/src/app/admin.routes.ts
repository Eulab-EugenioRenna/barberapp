import { WhatsAppComponent } from "./pages/whatsapp.component";
import { InventoryComponent } from "./pages/inventory.component";
import { LocationsComponent } from "./pages/locations.component";
import { AccessUnavailableComponent } from "./pages/access-unavailable.component";
import { PersonalAccountComponent } from "./pages/personal-account.component";
import { PersonalAgendaComponent } from "./pages/personal-agenda.component";
import { Routes } from "@angular/router";
import { authGuard } from "./core/auth.guard";
import { AdminAppComponent } from "./admin-app.component";
import { AdminAuthPageComponent } from "./pages/admin-auth-page.component";

const shellRoute = (path: string, view: string) => ({
  path,
  component: AdminAppComponent,
  canActivate: [authGuard],
  data: { view },
});

export const adminRoutes: Routes = [
  { path: "", pathMatch: "full", redirectTo: "login" },
  { path: "login", component: AdminAuthPageComponent },
  { path: "signup", component: AdminAuthPageComponent },
  { path: "account", component: PersonalAccountComponent, canActivate: [authGuard] },
  {
    path: "my-agenda",
    component: PersonalAgendaComponent,
    canActivate: [authGuard],
  },
  {
    path: "access-unavailable",
    component: AccessUnavailableComponent,
    canActivate: [authGuard],
  },
  { path:"inventory",component:InventoryComponent,canActivate:[authGuard]},
  { path: "whatsapp", component: WhatsAppComponent, canActivate: [authGuard] },
  { path: "locations", component: LocationsComponent, canActivate: [authGuard] },
  shellRoute("dashboard", "dashboard"),
  shellRoute("appointments", "appointments"),
  shellRoute("confirmations", "confirmations"),
  shellRoute("sales", "sales"),
  shellRoute("customers", "customers"),
  shellRoute("services", "services"),
  shellRoute("collaborators", "collaborators"),
  { path: "team", pathMatch: "full", redirectTo: "collaborators" },
  shellRoute("settings", "settings"),
  shellRoute("platform", "platform"),
  { path: "**", redirectTo: "login" },
];
