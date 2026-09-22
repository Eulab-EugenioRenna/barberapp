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
  shellRoute("dashboard", "dashboard"),
  shellRoute("appointments", "appointments"),
  shellRoute("sales", "sales"),
  shellRoute("customers", "customers"),
  shellRoute("services", "services"),
  shellRoute("collaborators", "collaborators"),
  shellRoute("settings", "settings"),
  shellRoute("platform", "platform"),
  { path: "**", redirectTo: "login" },
];
