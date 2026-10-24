import { canUseLocalFunction } from "@barber/shared/functions";
import { computed, Injectable, signal } from "@angular/core";

@Injectable({ providedIn: "root" })
export class SessionStore {
  private readonly tokenState = signal(
    localStorage.getItem("barber.session") ?? "",
  );
  private readonly refreshState = signal(
    localStorage.getItem("barber.refresh") ?? "",
  );
  private expiresAt = localStorage.getItem("barber.expires") ?? "";
  readonly refreshToken = computed(() => this.refreshState());
  syncFromStorage(): void {
    this.tokenState.set(localStorage.getItem("barber.session") ?? "");
    this.refreshState.set(localStorage.getItem("barber.refresh") ?? "");
    this.expiresAt = localStorage.getItem("barber.expires") ?? "";
    if (!this.tokenState()) this.currentUserState.set(null);
  }
  needsRefresh(): boolean {
    const expiry = Date.parse(this.expiresAt);
    return !Number.isFinite(expiry) || expiry <= Date.now() + 30_000;
  }
  setSession(response: {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  }): void {
    this.setToken(response.accessToken);
    this.refreshState.set(response.refreshToken);
    this.expiresAt = response.expiresAt;
    localStorage.setItem("barber.refresh", response.refreshToken);
    localStorage.setItem("barber.expires", response.expiresAt);
  }
  private readonly currentUserState = signal<any | null>(null);

  readonly token = computed(() => this.tokenState());
  readonly currentUser = computed(() => this.currentUserState());
  readonly isAuthenticated = computed(() => Boolean(this.tokenState()));

  setToken(token: string): void {
    this.tokenState.set(token);
    if (token) {
      localStorage.setItem("barber.session", token);
      return;
    }
    localStorage.removeItem("barber.session");
  }

  can(key: string): boolean {
    return canUseLocalFunction(this.currentUser(), key);
  }

  setCurrentUser(user: any | null): void {
    this.currentUserState.set(user);
  }

  clear(): void {
    this.refreshState.set("");
    this.expiresAt = "";
    localStorage.removeItem("barber.refresh");
    localStorage.removeItem("barber.expires");
    this.setToken("");
    this.setCurrentUser(null);
  }

  rememberRequestedUrl(url: string): void {
    localStorage.setItem("barber.pending-url", url);
  }

  consumeRequestedUrl(): string | null {
    const pending = localStorage.getItem("barber.pending-url");
    if (!pending) {
      return null;
    }
    localStorage.removeItem("barber.pending-url");
    return pending;
  }
}
