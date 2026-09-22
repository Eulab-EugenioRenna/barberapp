import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable } from "rxjs";
import { ADMIN_API_URL } from "./api-config";

@Injectable({ providedIn: "root" })
export class AuthApiService {
  private readonly http = inject(HttpClient);

  login(payload: { email: string; password: string }): Observable<any> {
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

  me(): Observable<any> {
    return this.http.get(`${ADMIN_API_URL}/auth/me`);
  }
}
