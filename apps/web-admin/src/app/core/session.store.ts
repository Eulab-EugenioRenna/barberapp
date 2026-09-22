import { computed, Injectable, signal } from "@angular/core";

@Injectable({ providedIn: "root" })
export class SessionStore {
  private readonly tokenState = signal(
    localStorage.getItem("barber.session") ?? "",
  );
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

  setCurrentUser(user: any | null): void {
    this.currentUserState.set(user);
  }

  clear(): void {
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
