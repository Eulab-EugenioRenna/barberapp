import { inFlightGetInterceptor } from "./app/core/in-flight-get.interceptor";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { bootstrapApplication } from "@angular/platform-browser";
import { inject } from "@angular/core";
import { RouteReuseStrategy, Router, provideRouter, withHashLocation, withPreloading, withViewTransitions } from "@angular/router";
import { AdminRouteReuseStrategy } from "./app/core/admin-route-reuse.strategy";
import { IdlePreloadingStrategy } from "./app/core/idle-preloading.strategy";
import { AdminRootComponent } from "./app/admin-root.component";
import { adminRoutes } from "./app/admin.routes";
import { apiNetworkInterceptor } from "./app/core/api-network.interceptor";
import { authInterceptor } from "./app/core/auth.interceptor";
import { prepareRemoteOnly } from "./app/core/remote-only";
import { AdminPwaService } from "./app/core/pwa.service";

bootstrapApplication(AdminRootComponent, {
  providers: [
    // Routes marked `data: { preload: true }` download quietly when the browser
    // is idle after the first render; never on data saver or 2G.
    provideRouter(
      adminRoutes,
      withHashLocation(),
      withPreloading(IdlePreloadingStrategy),
      // Page changes cross-fade (styles.css, #ui-shell-main). Same page with other
      // query params (filters, an opened booking) changes in place, never animated.
      withViewTransitions({
        skipInitialTransition: true,
        onViewTransitionCreated: ({ transition }) => {
          const router = inject(Router);
          const target = router.getCurrentNavigation()?.finalUrl;
          if (
            !target ||
            router.isActive(target, { paths: "exact", matrixParams: "exact", queryParams: "ignored", fragment: "ignored" }) ||
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
          )
            transition.skipTransition();
        },
      }),
    ),
    { provide: RouteReuseStrategy, useClass: AdminRouteReuseStrategy },
    provideHttpClient(withInterceptors([authInterceptor, inFlightGetInterceptor, apiNetworkInterceptor])),
  ],
})
  // Manifest/installazione e aggiornamenti; il worker gestisce solo push, mai richieste HTTP.
  .then((appRef) => appRef.injector.get(AdminPwaService))
  .catch((error) => console.error(error));

// The worker has no fetch handler, so the app never has to wait for it:
// registration and the cleanup of old caches run after the first render.
void prepareRemoteOnly(window).catch(() => undefined);
