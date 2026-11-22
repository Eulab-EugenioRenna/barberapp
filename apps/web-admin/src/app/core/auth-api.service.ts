import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable } from "rxjs";
import { ADMIN_API_URL } from "./api-config";
import type { PersonalAccount, PersonalNotices, PersonalSecurity, PersonalSessionList } from "@barber/shared/account";

@Injectable({ providedIn: "root" })
export class AuthApiService {
  private readonly http = inject(HttpClient);

  login(payload: { email: string; password?: string }): Observable<any> {
    return this.http.post(`${ADMIN_API_URL}/auth/login`, payload);
  }

  signup(payload: {
    companyName: string;
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }): Observable<any> {
    return this.http.post(`${ADMIN_API_URL}/auth/signup`, payload);
  }

  loginMethod(email: string): Observable<{ connect: boolean }> {
    return this.http.post<{ connect: boolean }>(
      `${ADMIN_API_URL}/auth/method`,
      { email },
    );
  }

  acceptConnect(payload: {
    firstName: string;
    lastName: string;
    password: string;
    challenge: string;
    accepted: true;
    consentVersion: string;
    newConnectPassword?: string;
  }): Observable<any> {
    return this.http.post(`${ADMIN_API_URL}/auth/connect/accept`, payload);
  }

  exchangeConnect(handoff: string): Observable<any> {
    return this.http.post(`${ADMIN_API_URL}/auth/connect/exchange`, {
      handoff,
    });
  }

  exchangeTechnicalAccess(handoff: string): Observable<any> {
    return this.http.post(
      `${ADMIN_API_URL}/auth/connect/technical/exchange`,
      { handoff },
    );
  }

  me(): Observable<any> {
    return this.http.get(`${ADMIN_API_URL}/auth/me`);
  }

  personalAccount() { return this.http.get<PersonalAccount>(`${ADMIN_API_URL}/account`); }
  personalSecurity() { return this.http.get<PersonalSecurity>(`${ADMIN_API_URL}/account/security`); }
  personalSessions() { return this.http.get<PersonalSessionList>(`${ADMIN_API_URL}/account/sessions`); }
  personalNotices() { return this.http.get<PersonalNotices>(`${ADMIN_API_URL}/account/notifications`); }
  logoutPersonalSession(id: string) { return this.http.post<{ loggedOut: boolean; current: boolean }>(`${ADMIN_API_URL}/account/sessions/${encodeURIComponent(id)}/logout`, {}); }
  logoutAllPersonalSessions() { return this.http.post<{ loggedOut: boolean }>(`${ADMIN_API_URL}/account/sessions/logout-all`, {}); }
  updatePersonalProfile(profile: { firstName: string; lastName: string }) { return this.http.put<{ profile: PersonalAccount["profile"] }>(`${ADMIN_API_URL}/account/profile`, profile); }
  setPersonalMfaPreference(preferredMethod: PersonalSecurity["preferredMethod"]) { return this.http.put<PersonalSecurity>(`${ADMIN_API_URL}/account/security/preferences`, { preferredMethod }); }
  removePersonalAuthenticator(id: string) { return this.http.delete<{ removed: boolean }>(`${ADMIN_API_URL}/account/authenticators/${encodeURIComponent(id)}`); }
  startPersonalAction(action: "UPDATE_PASSWORD" | "CONFIGURE_TOTP" | "VERIFY_EMAIL") { return this.http.post<{ redirectUrl: string }>(`${ADMIN_API_URL}/account/actions`, { action }); }
  revokePersonalDevice(id: string) { return this.http.delete<{ revoked: boolean; sessionsLoggedOut: boolean }>(`${ADMIN_API_URL}/account/devices/${encodeURIComponent(id)}`); }
}
