import {
  ConnectOnboardingModalComponent,
  ConnectOnboardingProfile,
  canRequestConnectMigration,
} from "./connect-onboarding-modal.component";
import { AloraBrandComponent } from "@barber/shared/brand";
import { CommonModule } from "@angular/common";
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  OnDestroy,
  Output,
  SimpleChanges,
  inject,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { AuthApiService } from "../core/auth-api.service";
import { SessionStore } from "../core/session.store";

type AuthMode = "login" | "signup";

@Component({
  selector: "barber-admin-auth-panel",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AloraBrandComponent,
    ConnectOnboardingModalComponent,
  ],
  styles: [
    `
      .auth-panel {
        overflow: hidden;
      }

      /* --- Toggle Accedi / Crea account --- */
      .auth-toggle {
        position: relative;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.25rem;
        padding: 0.3rem;
        border: 1px solid var(--line);
        border-radius: 999rem;
        background: rgba(30, 52, 37, 0.05);
      }

      .auth-toggle-thumb {
        position: absolute;
        top: 0.3rem;
        bottom: 0.3rem;
        left: 0.3rem;
        width: calc(50% - 0.425rem);
        border-radius: 999rem;
        background: linear-gradient(135deg, var(--brand), #1e3425);
        box-shadow: 0 0.5rem 1.25rem rgba(30, 52, 37, 0.28);
        transition: transform 340ms cubic-bezier(0.4, 0, 0.2, 1);
      }

      .auth-toggle-thumb.is-signup {
        transform: translateX(calc(100% + 0.25rem));
      }

      .auth-toggle-option {
        position: relative;
        z-index: 1;
        border: 0;
        border-radius: 999rem;
        background: transparent;
        padding: 0.62rem 1rem;
        color: var(--muted);
        font-weight: 700;
        cursor: pointer;
        transition: color 200ms ease;
      }

      .auth-toggle-option.active {
        color: #fff;
      }

      /* --- Animazione entrata form --- */
      .auth-form-login {
        animation: auth-slide-from-left 420ms cubic-bezier(0.4, 0, 0.2, 1);
      }

      .auth-form-signup {
        animation: auth-slide-from-right 420ms cubic-bezier(0.4, 0, 0.2, 1);
      }

      .auth-heading-login {
        animation: auth-fade-down 340ms ease;
      }

      .auth-heading-signup {
        animation: auth-fade-down 340ms ease;
      }

      @keyframes auth-slide-from-left {
        from {
          opacity: 0;
          transform: translateX(-1rem);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }

      @keyframes auth-slide-from-right {
        from {
          opacity: 0;
          transform: translateX(1rem);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }

      @keyframes auth-fade-down {
        from {
          opacity: 0;
          transform: translateY(-0.4rem);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* --- Campi extra del signup: apertura/chiusura animata --- */
      .auth-extra {
        display: grid;
        grid-template-rows: 0fr;
        opacity: 0;
        transition:
          grid-template-rows 420ms cubic-bezier(0.4, 0, 0.2, 1),
          opacity 260ms ease;
      }

      .auth-extra.is-open {
        grid-template-rows: 1fr;
        opacity: 1;
      }

      .auth-extra-inner {
        min-height: 0;
        overflow: hidden;
      }

      @media (prefers-reduced-motion: reduce) {
        .auth-form-login,
        .auth-form-signup,
        .auth-heading-login,
        .auth-heading-signup {
          animation: none;
        }

        .auth-toggle-thumb,
        .auth-extra {
          transition: none;
        }
      }
    `,
  ],
  template: `
    <alora-connect-onboarding-modal
      *ngIf="onboarding"
      [profile]="onboarding"
      [loading]="loading"
      [feedback]="onboardingFeedback"
      (accept)="acceptOnboarding($event)"
      (verifyLegacy)="submit($event)"
    ></alora-connect-onboarding-modal>
    <section
      class="auth-scroll mx-auto grid max-w-7xl items-center gap-6 px-4 py-8 lg:grid-cols-[1.05fr_0.95fr] lg:px-8"
    >
      <!-- Su mobile mostriamo solo il form; la hero compare da lg in su. -->
      <aside
        class="hero-panel hidden min-w-0 rounded-[2rem] p-6 text-white lg:block lg:p-10"
      >
        <alora-brand [onDark]="true"></alora-brand>
        <h1
          class="mt-4 font-display text-5xl font-semibold leading-none md:text-7xl"
        >
          Ogni giornata, al suo meglio.
        </h1>
        <p class="mt-6 max-w-xl text-base text-white/72 md:text-lg">
          Organizza appuntamenti, squadra, clienti e incassi con una visione
          chiara della giornata e dell'andamento del salone.
        </p>
        <div class="mt-8 grid min-w-0 gap-3 md:grid-cols-3 lg:grid-cols-1">
          <article class="glass-tile min-w-0 rounded-[1.4rem] p-4">
            <p class="text-xs uppercase tracking-[0.3em] text-white/50">
              Agenda
            </p>
            <strong class="mt-3 block break-words text-2xl md:text-3xl">
              Ordinata
            </strong>
            <span class="text-sm text-white/70"
              >Ogni appuntamento al suo posto</span
            >
          </article>
          <article class="glass-tile min-w-0 rounded-[1.4rem] p-4">
            <p class="text-xs uppercase tracking-[0.3em] text-white/50">
              Squadra
            </p>
            <strong class="mt-3 block break-words text-2xl md:text-3xl">
              Coordinata
            </strong>
            <span class="text-sm text-white/70"
              >Orari e carichi sempre visibili</span
            >
          </article>
          <article class="glass-tile min-w-0 rounded-[1.4rem] p-4">
            <p class="text-xs uppercase tracking-[0.3em] text-white/50">
              Risultati
            </p>
            <strong class="mt-3 block break-words text-2xl md:text-3xl">
              Chiari
            </strong>
            <span class="text-sm text-white/70"
              >Incassi e clienti in primo piano</span
            >
          </article>
        </div>
      </aside>

      <section
        class="panel auth-panel min-w-0 rounded-[1.5rem] p-4 sm:p-6 md:rounded-[2rem] md:p-8"
      >
        <alora-brand class="lg:hidden"></alora-brand>

        <div
          class="auth-toggle mt-3 lg:mt-0"
          role="tablist"
          aria-label="Modalita accesso"
        >
          <span
            class="auth-toggle-thumb"
            [class.is-signup]="authMode === 'signup'"
            aria-hidden="true"
          ></span>
          <button
            type="button"
            role="tab"
            class="auth-toggle-option"
            [class.active]="authMode === 'login'"
            [attr.aria-selected]="authMode === 'login'"
            (click)="setMode('login')"
          >
            Accedi
          </button>
          <button
            type="button"
            role="tab"
            class="auth-toggle-option"
            [class.active]="authMode === 'signup'"
            [attr.aria-selected]="authMode === 'signup'"
            (click)="setMode('signup')"
          >
            Richiedi attivazione
          </button>
        </div>

        <div class="mt-4">
          <p class="eyebrow text-[var(--accent)]">Accesso</p>
          <h2
            class="mt-2 font-display text-2xl sm:text-3xl md:text-4xl"
            [class.auth-heading-login]="authMode === 'login'"
            [class.auth-heading-signup]="authMode === 'signup'"
          >
            {{
              authMode === "login"
                ? "Bentornato nel tuo salone"
                : "Richiedi il tuo spazio"
            }}
          </h2>
        </div>

        <form
          class="mt-4 grid gap-3"
          [class.auth-form-login]="authMode === 'login'"
          [class.auth-form-signup]="authMode === 'signup'"
          (ngSubmit)="submit()"
        >
          <div class="auth-extra is-open" *ngIf="authMode === 'signup'">
            <div class="auth-extra-inner grid gap-3">
              <div class="grid gap-3 md:grid-cols-2">
                <label class="field"
                  ><span
                    >Nome
                    <em class="required-mark" aria-hidden="true">*</em></span
                  ><input
                    [(ngModel)]="signupForm.firstName"
                    name="signupFirstName"
                    placeholder="Giulia"
                    autocomplete="given-name"
                    required
                /></label>
                <label class="field"
                  ><span
                    >Cognome
                    <em class="required-mark" aria-hidden="true">*</em></span
                  ><input
                    [(ngModel)]="signupForm.lastName"
                    name="signupLastName"
                    placeholder="Riva"
                    autocomplete="family-name"
                    required
                /></label>
              </div>
              <label class="field">
                <span
                  >Nome del salone o boutique
                  <em class="required-mark" aria-hidden="true">*</em></span
                >
                <input
                  [(ngModel)]="signupForm.companyName"
                  name="companyName"
                  placeholder="Atelier Milano"
                  autocomplete="organization"
                  required
                />
              </label>
            </div>
          </div>

          <label class="field"
            ><span
              >Email <em class="required-mark" aria-hidden="true">*</em></span
            ><input
              [(ngModel)]="loginForm.email"
              name="loginEmail"
              type="email"
              placeholder="direzione@atelier.it"
              autocomplete="email"
              required
          /></label>
          <label class="field" *ngIf="authMode === 'signup'"
            ><span
              >Password
              <em
                *ngIf="authMode === 'signup'"
                class="required-mark"
                aria-hidden="true"
                >*</em
              ></span
            ><input
              [(ngModel)]="loginForm.password"
              name="loginPassword"
              type="password"
              placeholder="••••••••"
              [autocomplete]="
                authMode === 'login' ? 'current-password' : 'new-password'
              "
              [attr.minlength]="authMode === 'signup' ? 8 : null"
              [required]="authMode === 'signup'"
          /></label>

          <div class="auth-extra is-open" *ngIf="authMode === 'signup'">
            <div class="auth-extra-inner">
              <label class="field">
                <span
                  >Ripeti password
                  <em class="required-mark" aria-hidden="true">*</em></span
                >
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
            </div>
          </div>

          <p *ngIf="authMode === 'login'" class="text-sm text-[var(--muted)]">
            Continua su EULAB Connect per completare l’accesso con il tuo account.
          </p>
          <p
            *ngIf="feedback"
            role="alert"
            aria-live="assertive"
            class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            {{ feedback }}
          </p>

          <button
            type="submit"
            class="primary-btn"
            [disabled]="loading || !formValid"
          >
            {{
              loading
                ? "Un momento..."
                : authMode === "login"
                  ? "Accedi"
                  : "Invia richiesta"
            }}
          </button>
        </form>
      </section>
    </section>
  `,
})
export class AdminAuthPanelComponent implements OnChanges, OnInit, OnDestroy {
  private readonly authApi = inject(AuthApiService);
  private readonly sessionStore = inject(SessionStore);
  private readonly router = inject(Router);

  @Input() mode: AuthMode = "login";
  @Output() modeChange = new EventEmitter<AuthMode>();

  authMode: AuthMode = "login";
  loading = false;
  feedback = "";
  loginForm = { email: "", password: "" };
  signupForm = { companyName: "", firstName: "", lastName: "" };
  signupPasswordConfirm = "";

  onboarding: ConnectOnboardingProfile | null = null;
  onboardingFeedback = "";
  private destroyed = false;
  private onboardingTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    void this.finishConnectReturn();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.clearCredentials();
  }

  private clearCredentials(): void {
    this.loginForm.password = "";
    this.signupPasswordConfirm = "";
    if (this.onboardingTimer) clearTimeout(this.onboardingTimer);
    this.onboardingTimer = null;
  }

  private async finishConnectReturn(): Promise<void> {
    const url = new URL(window.location.href);
    const [route,hashQuery=""] = url.hash.slice(1).split("?");
    const fragment = new URLSearchParams(hashQuery);
    const handoff = fragment.get("alora_connect") ?? url.searchParams.get("alora_connect");
    const error = fragment.get("connect_error") ?? url.searchParams.get("connect_error");
    if (!handoff && !error) return;
    url.searchParams.delete("alora_connect");
    fragment.delete("alora_connect");
    fragment.delete("connect_error");
    url.hash = route + (fragment.size ? "?" + fragment.toString() : "");
    url.searchParams.delete("connect_error");
    window.history.replaceState(null, "", url.href);
    if (error) {
      this.feedback =
        "Accesso Connect non completato. Se su Connect è attivo un altro account, cambia account e riprova con la stessa email inserita in ALORA.";
      return;
    }
    this.loading = true;
    try {
      const session = await firstValueFrom(
        this.authApi.exchangeConnect(handoff!),
      );
      if (this.destroyed) return;
      this.sessionStore.setSession(session);
      await this.enterApplication();
    } catch {
      this.feedback = "Accesso Connect da ripetere. Premi nuovamente Accedi.";
    } finally {
      this.loading = false;
    }
  }

  async acceptOnboarding(profile: {
    firstName: string;
    lastName: string;
    newConnectPassword?: string;
  }): Promise<void> {
    if (
      !this.onboarding ||
      this.loading ||
      !canRequestConnectMigration(this.onboarding) ||
      !this.loginForm.password
    )
      return;
    if(this.onboarding.request?.nextAction === "choose_connect_password" && (!profile.newConnectPassword || profile.newConnectPassword === this.loginForm.password)) {
      this.onboardingFeedback = "Scegli una nuova password Connect diversa da quella locale.";
      return;
    }
    this.loading = true;
    this.onboardingFeedback = "";
    if (this.onboardingTimer) clearTimeout(this.onboardingTimer);
    try {
      const result = await firstValueFrom(
        this.authApi.acceptConnect({
          ...profile,
          challenge: this.onboarding.challenge,
          password: this.loginForm.password,
          accepted: true,
          consentVersion: this.onboarding.version,
        }),
      );
      this.clearCredentials();
      if (!this.destroyed && this.onboarding) {
        this.onboarding = {
          ...this.onboarding,
          challenge: "",
          request: result.request,
        };
        this.onboardingFeedback =
          "Richiesta inviata. Attendi l’approvazione EULAB prima di accedere.";
      }
    } catch (error: any) {
      this.clearCredentials();
      if (this.onboarding)
        this.onboarding = { ...this.onboarding, challenge: "" };
      this.onboardingFeedback =
        (typeof error?.error?.message === "string"
          ? error.error.message
          : "Invio non completato.") +
        " Ricarica la pagina e verifica nuovamente credenziali e stato prima di un nuovo invio.";
    } finally {
      this.loading = false;
    }
  }

  private async enterApplication(): Promise<void> {
    const currentUser = await firstValueFrom(this.authApi.me());
    this.sessionStore.setCurrentUser(currentUser);
    const pending = this.sessionStore.consumeRequestedUrl();
    await this.router.navigateByUrl(
      pending ||
        (currentUser?.role === "platform_admin"
          ? "/platform"
          : currentUser?.role === "collaborator"
            ? "/my-agenda"
            : "/dashboard"),
    );
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["mode"]) {
      this.authMode = this.mode;
    }
  }

  get formValid(): boolean {
    const credentialsValid =
      this.loginForm.email.trim().length > 0 &&
      (this.authMode === "login" || this.loginForm.password.length >= 8);
    if (this.authMode === "login") return credentialsValid;
    return Boolean(
      credentialsValid &&
      this.signupForm.companyName.trim() &&
      this.signupForm.firstName.trim() &&
      this.signupForm.lastName.trim() &&
      this.signupPasswordConfirm.length >= 8,
    );
  }

  setMode(mode: AuthMode): void {
    if (this.authMode === mode) {
      return;
    }
    this.authMode = mode;
    this.clearCredentials();
    this.feedback = "";
    this.modeChange.emit(mode);
  }

  async submit(legacyPassword?: string): Promise<void> {
    if (this.loading) return;
    if (legacyPassword !== undefined) this.loginForm.password = legacyPassword;
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
          ? await firstValueFrom(
              this.authApi.login(
                { email: this.loginForm.email,
                  ...(legacyPassword !== undefined ? { password: legacyPassword } : {}) },
              ),
            )
          : await firstValueFrom(
              this.authApi.signup({
                companyName: this.signupForm.companyName,
                firstName: this.signupForm.firstName,
                lastName: this.signupForm.lastName,
                email: this.loginForm.email,
                password: this.loginForm.password,
              }),
            );

      if (this.destroyed) return;
      if (authResponse.status === "connect_redirect") {
        this.clearCredentials();
        window.location.assign(authResponse.redirectUrl);
        return;
      }
      if (authResponse.status === "migration_pending") {
        this.clearCredentials();
        this.feedback = `Richiesta ${authResponse.request.requestId} ricevuta. Attendi l’approvazione EULAB; l’accesso non è ancora abilitato.`;
        return;
      }
      if (authResponse.onboarding) {
        this.sessionStore.clear();
        this.onboarding = authResponse.onboarding;
        this.onboardingFeedback = authResponse.onboarding.feedback ?? "";
        if (this.onboarding?.needsLegacyVerification) {
          this.clearCredentials();
          return;
        }
        if (!canRequestConnectMigration(this.onboarding!)) {
          this.clearCredentials();
          return;
        }
        if (this.onboardingTimer) clearTimeout(this.onboardingTimer);
        this.onboardingTimer = setTimeout(() => {
          this.clearCredentials();
          if (this.onboarding)
            this.onboarding = { ...this.onboarding, challenge: "" };
          this.onboardingFeedback =
            "La verifica è scaduta. Ricarica la pagina e inserisci nuovamente le credenziali per inviare la richiesta.";
        }, 120_000);
        return;
      }
      this.sessionStore.setSession(authResponse);
      this.clearCredentials();
      await this.enterApplication();
    } catch (error: any) {
      this.clearCredentials();
      this.feedback =
        error?.error?.message ||
        error?.message ||
        "Non siamo riusciti a completare l'accesso. Riprova.";
      if (this.onboarding?.needsLegacyVerification) this.onboardingFeedback = this.feedback;
    } finally {
      this.loading = false;
    }
  }
}
