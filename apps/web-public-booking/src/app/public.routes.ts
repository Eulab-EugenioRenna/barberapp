import { Routes } from "@angular/router";
import { PublicBookingAppComponent } from "./public-booking-app.component";

export const publicRoutes: Routes = [
  { path: "", component: PublicBookingAppComponent },
  { path: ":tenantSlug", component: PublicBookingAppComponent },
  { path: "**", component: PublicBookingAppComponent },
];
