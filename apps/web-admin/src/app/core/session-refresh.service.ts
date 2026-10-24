import { HttpBackend, HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import {
  defer,
  finalize,
  firstValueFrom,
  from,
  Observable,
  shareReplay,
} from "rxjs";
import { ADMIN_API_URL } from "./api-config";
import { SessionStore } from "./session.store";

@Injectable({ providedIn: "root" })
export class SessionRefreshService {
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly store = inject(SessionStore);
  private pending?: Observable<void>;

  refresh(force = false): Observable<void> {
    if (!this.pending) {
      const requestedToken = this.store.token();
      const renew = async () => {
        this.store.syncFromStorage();
        // Another tab may have already rotated this session while we waited.
        if (
          !this.store.needsRefresh() &&
          (!force || requestedToken !== this.store.token())
        )
          return;
        const originalRefresh = this.store.refreshToken();
        if (!originalRefresh) throw new Error("Accedi per continuare");
        try {
          const response: any = await firstValueFrom(
            this.http.post(`${ADMIN_API_URL}/auth/refresh`, {
              refreshToken: originalRefresh,
            }),
          );
          this.store.syncFromStorage();
          if (this.store.refreshToken() !== originalRefresh)
            throw new Error("Sessione cambiata durante il rinnovo");
          this.store.setSession(response);
        } catch (error) {
          this.store.syncFromStorage();
          if (this.store.refreshToken() === originalRefresh) this.store.clear();
          throw error;
        }
      };
      this.pending = defer(() =>
        from(
          navigator.locks
            ? navigator.locks.request("barber.session.refresh", renew)
            : renew(),
        ),
      ).pipe(
        finalize(() => {
          this.pending = undefined;
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.pending;
  }

  logout(): void {
    this.store.syncFromStorage();
    const token = this.store.token();
    this.store.clear();
    if (token)
      this.http
        .post(
          `${ADMIN_API_URL}/auth/logout`,
          {},
          { headers: { Authorization: `Bearer ${token}` } },
        )
        .subscribe({ error: () => undefined });
  }
}
