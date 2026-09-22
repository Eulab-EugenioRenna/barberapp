import { Injectable, computed, inject, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { AdminApiService } from "./admin-api.service";
import { AuthApiService } from "./auth-api.service";
import { SessionStore } from "./session.store";

@Injectable({ providedIn: "root" })
export class AdminFacade {
  private readonly adminApi = inject(AdminApiService);
  private readonly authApi = inject(AuthApiService);
  private readonly sessionStore = inject(SessionStore);

  readonly loading = signal(false);
  readonly feedback = signal("");
  readonly currentUser = computed(() => this.sessionStore.currentUser());
  readonly tenant = signal<any>(null);
  readonly revenueMetrics = signal<any[]>([]);
  readonly revenueReport = signal<any>(null);
  readonly appointmentStats = signal<any>(null);
  readonly collaboratorStats = signal<any[]>([]);
  readonly serviceStats = signal<any[]>([]);
  readonly appointments = signal<any[]>([]);
  readonly sales = signal<any[]>([]);
  readonly services = signal<any[]>([]);
  readonly products = signal<any[]>([]);
  readonly collaborators = signal<any[]>([]);
  readonly customers = signal<any[]>([]);
  readonly platformTenants = signal<any[]>([]);
  readonly platformPlans = signal<any[]>([]);
  readonly platformSubscriptions = signal<any[]>([]);

  async refreshAll(): Promise<{
    mode: "platform" | "tenant" | "unauthenticated";
  }> {
    if (!this.sessionStore.isAuthenticated()) {
      return { mode: "unauthenticated" };
    }

    this.loading.set(true);
    this.feedback.set("");

    try {
      const currentUser = await firstValueFrom(this.authApi.me());
      this.sessionStore.setCurrentUser(currentUser);

      if (currentUser?.role === "platform_admin") {
        const { tenants, plans, subscriptions }: any = await firstValueFrom(
          this.adminApi.loadPlatformData(),
        );
        this.platformTenants.set(tenants as any[]);
        this.platformPlans.set(plans as any[]);
        this.platformSubscriptions.set(subscriptions as any[]);
        return { mode: "platform" };
      }

      const coreResponse: any = await firstValueFrom(
        this.adminApi.loadAdminCoreData(),
      );
      this.tenant.set(coreResponse.tenant);
      this.appointments.set(coreResponse.appointments as any[]);
      this.services.set(coreResponse.services as any[]);
      this.collaborators.set(coreResponse.collaborators as any[]);
      this.customers.set(coreResponse.customers as any[]);

      void firstValueFrom(this.adminApi.loadAdminStatsData()).then(
        (statsResponse: any) => {
          this.revenueReport.set(statsResponse.revenue || null);
          this.revenueMetrics.set(statsResponse.revenue?.metrics || []);
          this.appointmentStats.set(statsResponse.appointmentStats);
          this.collaboratorStats.set(statsResponse.collaboratorStats as any[]);
          this.serviceStats.set(statsResponse.serviceStats as any[]);
          this.sales.set(statsResponse.sales as any[]);
          this.products.set(statsResponse.products as any[]);
        },
        () => {
          // Keep core data rendered even if secondary stats fail.
        },
      );

      return { mode: "tenant" };
    } finally {
      this.loading.set(false);
    }
  }

  async refreshShell(): Promise<{
    mode: "platform" | "tenant" | "unauthenticated";
  }> {
    if (!this.sessionStore.isAuthenticated()) {
      return { mode: "unauthenticated" };
    }

    this.loading.set(true);
    this.feedback.set("");

    try {
      const currentUser = await firstValueFrom(this.authApi.me());
      this.sessionStore.setCurrentUser(currentUser);

      if (currentUser?.role === "platform_admin") {
        const { tenants, plans, subscriptions }: any = await firstValueFrom(
          this.adminApi.loadPlatformData(),
        );
        this.platformTenants.set(tenants as any[]);
        this.platformPlans.set(plans as any[]);
        this.platformSubscriptions.set(subscriptions as any[]);
        return { mode: "platform" };
      }

      const response: any = await firstValueFrom(this.adminApi.loadShellData());
      this.tenant.set(response.tenant);
      return { mode: "tenant" };
    } finally {
      this.loading.set(false);
    }
  }

  setFeedback(message: string): void {
    this.feedback.set(message);
  }

  clearSession(): void {
    this.sessionStore.clear();
  }
}
