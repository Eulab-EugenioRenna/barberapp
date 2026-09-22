import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter, withHashLocation } from "@angular/router";
import { AdminRootComponent } from "./app/admin-root.component";
import { adminRoutes } from "./app/admin.routes";
import { authInterceptor } from "./app/core/auth.interceptor";

bootstrapApplication(AdminRootComponent, {
  providers: [
    provideRouter(adminRoutes, withHashLocation()),
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
}).catch((error) => console.error(error));
