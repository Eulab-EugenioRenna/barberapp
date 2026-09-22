import { provideHttpClient } from "@angular/common/http";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { PublicRootComponent } from "./app/public-root.component";
import { publicRoutes } from "./app/public.routes";

bootstrapApplication(PublicRootComponent, {
  providers: [provideRouter(publicRoutes), provideHttpClient()],
}).catch((error) => console.error(error));
