import { canUseLocalFunction } from "@barber/shared/functions";
import { computed, Injectable, signal } from "@angular/core";

/**
 * /auth/me result of this tab (user, role, functions, collaborator link), taken
 * at login and kept in sessionStorage: guards and menus read it synchronously.
 * It is never authority — the server re-checks every call.
 */
const PROFILE_KEY = "barber.me";
/** Shared by all tabs: who the stored tokens belong to. */
const IDENTITY_KEY = "barber.identity";
function readProfile(): { user: any; loadedAt: number } | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(PROFILE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.user && typeof parsed.loadedAt === "number" ? parsed : null;
  } catch {
    return null;
  }
}
function writeProfile(user: any | null, loadedAt: number): void {
  try {
    if (user) globalThis.sessionStorage?.setItem(PROFILE_KEY, JSON.stringify({ user, loadedAt }));
    else globalThis.sessionStorage?.removeItem(PROFILE_KEY);
  } catch {
    // Private mode or full storage: the profile stays in memory only.
  }
}

@Injectable({ providedIn: "root" })
export class SessionStore {
  private readonly tokenState = signal(
    localStorage.getItem("barber.session") ?? "",
  );
  private readonly storedProfile = this.tokenState() ? readProfile() : null;
  private readonly currentUserState = signal<any | null>(this.storedProfile?.user ?? null);
  private userLoadedAt = this.storedProfile?.loadedAt ?? 0;
  private readonly refreshState = signal(
    localStorage.getItem("barber.refresh") ?? "",
  );
  private expiresAt = localStorage.getItem("barber.expires") ?? "";
  readonly refreshToken = computed(() => this.refreshState());
  syncFromStorage(): void {
    this.tokenState.set(localStorage.getItem("barber.session") ?? "");
    this.refreshState.set(localStorage.getItem("barber.refresh") ?? "");
    this.expiresAt = localStorage.getItem("barber.expires") ?? "";
    // Another tab signed in as someone else: this tab's profile is not theirs.
    const identity = localStorage.getItem(IDENTITY_KEY);
    if (
      this.currentUserState() &&
      (!this.tokenState() || (identity && identity !== this.currentUserState().id))
    )
      this.forgetProfile();
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
    this.userLoadedAt = user ? Date.now() : 0;
    writeProfile(user, this.userLoadedAt);
    if (user?.id) localStorage.setItem(IDENTITY_KEY, user.id);
  }

  private forgetProfile(): void {
    this.currentUserState.set(null);
    this.userLoadedAt = 0;
    writeProfile(null, 0);
  }

  /** Milliseconds since the stored profile was read from /auth/me. */
  userAge(): number {
    return this.userLoadedAt ? Date.now() - this.userLoadedAt : Number.POSITIVE_INFINITY;
  }

  clear(): void {
    this.refreshState.set("");
    this.expiresAt = "";
    localStorage.removeItem("barber.refresh");
    localStorage.removeItem("barber.expires");
    localStorage.removeItem(IDENTITY_KEY);
    this.setToken("");
    this.forgetProfile();
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
