import { inFlightGetInterceptor } from "./app/core/in-flight-get.interceptor";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { bootstrapApplication } from "@angular/platform-browser";
import { PreloadAllModules, provideRouter, withHashLocation, withPreloading } from "@angular/router";
import { AdminRootComponent } from "./app/admin-root.component";
import { adminRoutes } from "./app/admin.routes";
import { apiNetworkInterceptor } from "./app/core/api-network.interceptor";
import { authInterceptor } from "./app/core/auth.interceptor";
import { prepareRemoteOnly } from "./app/core/remote-only";
import { AdminPwaService } from "./app/core/pwa.service";

bootstrapApplication(AdminRootComponent, {
  providers: [
    // Other pages download quietly after the first one is on screen.
    provideRouter(adminRoutes, withHashLocation(), withPreloading(PreloadAllModules)),
    provideHttpClient(withInterceptors([authInterceptor, inFlightGetInterceptor, apiNetworkInterceptor])),
  ],
})
  // Manifest/installazione e aggiornamenti; il worker gestisce solo push, mai richieste HTTP.
  .then((appRef) => appRef.injector.get(AdminPwaService))
  .catch((error) => console.error(error));

// The worker has no fetch handler, so the app never has to wait for it:
// registration and the cleanup of old caches run after the first render.
void prepareRemoteOnly(window).catch(() => undefined);
