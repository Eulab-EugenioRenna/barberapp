import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter, withHashLocation } from "@angular/router";
import { AdminRootComponent } from "./app/admin-root.component";
import { adminRoutes } from "./app/admin.routes";
import { authInterceptor } from "./app/core/auth.interceptor";
import { AdminPwaService } from "./app/core/pwa.service";

bootstrapApplication(AdminRootComponent, {
  providers: [
    provideRouter(adminRoutes, withHashLocation()),
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
})
  // Instanzia il servizio PWA all'avvio per registrare il service worker e
  // avviare il controllo aggiornamenti, anche prima del login.
  .then((appRef) => appRef.injector.get(AdminPwaService))
  .catch((error) => console.error(error));
