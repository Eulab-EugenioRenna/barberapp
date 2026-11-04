import { inFlightGetInterceptor } from "./app/core/in-flight-get.interceptor";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter, withHashLocation } from "@angular/router";
import { AdminRootComponent } from "./app/admin-root.component";
import { adminRoutes } from "./app/admin.routes";
import { authInterceptor } from "./app/core/auth.interceptor";
import { prepareRemoteOnly } from "./app/core/remote-only";
import { AdminPwaService } from "./app/core/pwa.service";

prepareRemoteOnly(window)
  .then(() =>
    bootstrapApplication(AdminRootComponent, {
      providers: [
        provideRouter(adminRoutes, withHashLocation()),
        provideHttpClient(withInterceptors([authInterceptor, inFlightGetInterceptor])),
      ],
    }),
  )
  // Manifest/installazione e aggiornamenti; il worker gestisce solo push, mai richieste HTTP.
  .then((appRef) => appRef.injector.get(AdminPwaService))
  .catch((error) => console.error(error));
