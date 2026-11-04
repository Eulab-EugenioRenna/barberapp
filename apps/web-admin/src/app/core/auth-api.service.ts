import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable } from "rxjs";
import { ADMIN_API_URL } from "./api-config";

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
}
