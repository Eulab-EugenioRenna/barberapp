import { Component, OnInit, inject } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { AdminAuthPanelComponent } from "../auth/admin-auth-panel.component";

@Component({
  selector: "barber-admin-auth-page",
  standalone: true,
  imports: [AdminAuthPanelComponent],
  template: `
    <main class="admin-shell min-h-screen">
      <barber-admin-auth-panel
        [mode]="authMode"
        (modeChange)="onModeChange($event)"
      ></barber-admin-auth-panel>
    </main>
  `,
})
export class AdminAuthPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  authMode: "login" | "signup" = "login";

  ngOnInit(): void {
    this.authMode =
      this.route.snapshot.routeConfig?.path === "signup" ? "signup" : "login";
  }

  onModeChange(mode: "login" | "signup"): void {
    this.authMode = mode;
    void this.router.navigate([`/${mode}`]);
  }
}
