import { CommonModule } from "@angular/common";
import { Component, OnInit, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { AuthApiService } from "../core/auth-api.service";
import { SessionStore } from "../core/session.store";

@Component({
  selector: "barber-admin-auth-page",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <main class="admin-shell min-h-screen">
      <section
        class="mx-auto grid min-h-screen max-w-7xl items-center gap-6 px-4 py-8 lg:grid-cols-[1.05fr_0.95fr] lg:px-8"
      >
        <aside class="hero-panel rounded-[2rem] p-6 text-white lg:p-10">
          <p class="eyebrow">Platforma booking</p>
          <h1
            class="mt-4 font-display text-5xl font-semibold leading-none md:text-7xl"
          >
            Un gestionale davvero operativo, non una demo.
          </h1>
          <p class="mt-6 max-w-xl text-base text-white/72 md:text-lg">
            Onboarding tenant, dashboard con valori DB, agenda modificabile,
            white label e booking pubblico in una UI piu moderna e mobile-first.
          </p>
          <div class="mt-8 grid gap-3 md:grid-cols-3">
            <article class="glass-tile rounded-[1.4rem] p-4">
              <p class="text-xs uppercase tracking-[0.3em] text-white/50">
                Dashboard
              </p>
              <strong class="mt-3 block text-3xl">Live</strong>
              <span class="text-sm text-white/70">Metriche dal database</span>
            </article>
            <article class="glass-tile rounded-[1.4rem] p-4">
              <p class="text-xs uppercase tracking-[0.3em] text-white/50">
                Booking
              </p>
              <strong class="mt-3 block text-3xl">CRUD</strong>
              <span class="text-sm text-white/70"
                >Crea e modifica appuntamenti</span
              >
            </article>
            <article class="glass-tile rounded-[1.4rem] p-4">
              <p class="text-xs uppercase tracking-[0.3em] text-white/50">
                White label
              </p>
              <strong class="mt-3 block text-3xl">Hybrid</strong>
              <span class="text-sm text-white/70"
                >Tenant pubblico o chiuso</span
              >
            </article>
          </div>
        </aside>

        <section class="panel rounded-[2rem] p-5 md:p-8">
          <div class="flex items-center justify-between">
            <div>
              <p class="eyebrow text-[var(--accent)]">Accesso</p>
              <h2 class="mt-2 font-display text-4xl">
                {{ authMode === "login" ? "Accedi" : "Crea il tuo tenant" }}
              </h2>
            </div>
            <button type="button" class="pill-btn" (click)="toggleMode()">
              {{ authMode === "login" ? "Signup" : "Login" }}
            </button>
          </div>

          <form class="mt-8 grid gap-4" (ngSubmit)="submit()">
            <div
              *ngIf="authMode === 'signup'"
              class="grid gap-4 md:grid-cols-2"
            >
              <label class="field"
                ><span>Nome</span
                ><input
                  [(ngModel)]="signupForm.firstName"
                  name="signupFirstName"
                  placeholder="Giulia"
                  autocomplete="given-name"
                  required
              /></label>
              <label class="field"
                ><span>Cognome</span
                ><input
                  [(ngModel)]="signupForm.lastName"
                  name="signupLastName"
                  placeholder="Riva"
                  autocomplete="family-name"
                  required
              /></label>
            </div>

            <label *ngIf="authMode === 'signup'" class="field">
              <span>Nome attivita</span>
              <input
                [(ngModel)]="signupForm.companyName"
                name="companyName"
                placeholder="Atelier Barberia Milano"
                autocomplete="organization"
                required
              />
            </label>

            <label class="field"
              ><span>Email</span
              ><input
                [(ngModel)]="loginForm.email"
                name="loginEmail"
                type="email"
                placeholder="owner@atelier.it"
                autocomplete="email"
                required
            /></label>
            <label class="field"
              ><span>Password</span
              ><input
                [(ngModel)]="loginForm.password"
                name="loginPassword"
                type="password"
                placeholder="••••••••"
                [autocomplete]="authMode === 'login' ? 'current-password' : 'new-password'"
                minlength="8"
                required
            /></label>

            <label *ngIf="authMode === 'signup'" class="field">
              <span>Ripeti password</span>
              <input
                [(ngModel)]="signupPasswordConfirm"
                name="signupPasswordConfirm"
                type="password"
                placeholder="••••••••"
                autocomplete="new-password"
                minlength="8"
                required
              />
            </label>

            <p
              *ngIf="feedback"
              role="alert"
              aria-live="assertive"
              class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              {{ feedback }}
            </p>

            <button type="submit" class="primary-btn" [disabled]="loading || !formValid">
              {{
                loading
                  ? "Caricamento..."
                  : authMode === "login"
                    ? "Accedi alla dashboard"
                    : "Crea account e tenant"
              }}
            </button>
          </form>
        </section>
      </section>
    </main>
  `,
})
export class AdminAuthPageComponent implements OnInit {
  private readonly authApi = inject(AuthApiService);
  private readonly sessionStore = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  authMode: "login" | "signup" = "login";
  loading = false;
  feedback = "";
  loginForm = { email: "", password: "" };
  signupForm = {
    companyName: "",
    firstName: "",
    lastName: "",
  };
  signupPasswordConfirm = "";

  get formValid(): boolean {
    const credentialsValid =
      this.loginForm.email.trim().length > 0 &&
      this.loginForm.password.length >= 8;
    if (this.authMode === "login") return credentialsValid;
    return Boolean(
      credentialsValid &&
        this.signupForm.companyName.trim() &&
        this.signupForm.firstName.trim() &&
        this.signupForm.lastName.trim() &&
        this.signupPasswordConfirm.length >= 8,
    );
  }

  ngOnInit(): void {
    this.authMode =
      this.route.snapshot.routeConfig?.path === "signup" ? "signup" : "login";
  }

  toggleMode(): void {
    const nextMode = this.authMode === "login" ? "signup" : "login";
    this.authMode = nextMode;
    void this.router.navigate([`/${nextMode}`]);
  }

  async submit(): Promise<void> {
    this.loading = true;
    this.feedback = "";

    try {
      if (
        this.authMode === "signup" &&
        this.loginForm.password !== this.signupPasswordConfirm
      ) {
        throw new Error("Le password non coincidono");
      }

      const authResponse: any =
        this.authMode === "login"
          ? await firstValueFrom(this.authApi.login(this.loginForm))
          : await firstValueFrom(
              this.authApi.signup({
                companyName: this.signupForm.companyName,
                firstName: this.signupForm.firstName,
                lastName: this.signupForm.lastName,
                email: this.loginForm.email,
                password: this.loginForm.password,
              }),
            );

      this.sessionStore.setToken(authResponse.accessToken);
      const currentUser = await firstValueFrom(this.authApi.me());
      this.sessionStore.setCurrentUser(currentUser);

      const pending = this.sessionStore.consumeRequestedUrl();
      if (pending) {
        await this.router.navigateByUrl(pending);
        return;
      }

      await this.router.navigateByUrl(
        currentUser?.role === "platform_admin" ? "/platform" : "/dashboard",
      );
    } catch (error: any) {
      this.feedback =
        error?.error?.message || error?.message || "Operazione non riuscita";
    } finally {
      this.loading = false;
    }
  }
}
