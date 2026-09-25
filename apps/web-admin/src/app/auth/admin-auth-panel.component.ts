import { CommonModule } from "@angular/common";
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
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
  imports: [CommonModule, FormsModule],
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
        background: rgba(15, 23, 32, 0.05);
      }

      .auth-toggle-thumb {
        position: absolute;
        top: 0.3rem;
        bottom: 0.3rem;
        left: 0.3rem;
        width: calc(50% - 0.425rem);
        border-radius: 999rem;
        background: linear-gradient(135deg, var(--brand), #123b33);
        box-shadow: 0 0.5rem 1.25rem rgba(28, 124, 100, 0.28);
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
        padding: 0.7rem 1rem;
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
    <section
      class="auth-scroll mx-auto grid max-w-7xl items-center gap-6 px-4 py-8 lg:grid-cols-[1.05fr_0.95fr] lg:px-8"
    >
      <!-- Su mobile mostriamo solo il form; la hero compare da lg in su. -->
      <aside
        class="hero-panel hidden min-w-0 rounded-[2rem] p-6 text-white lg:block lg:p-10"
      >
        <p class="eyebrow">Direzione salone</p>
        <h1
          class="mt-4 font-display text-5xl font-semibold leading-none md:text-7xl"
        >
          Il tuo salone, sempre sotto controllo.
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

      <section class="panel auth-panel min-w-0 rounded-[2rem] p-5 md:p-8">
        <p class="eyebrow text-[var(--accent)] lg:hidden">Direzione salone</p>

        <div
          class="auth-toggle mt-4 lg:mt-0"
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
            Crea account
          </button>
        </div>

        <div class="mt-6">
          <p class="eyebrow text-[var(--accent)]">Accesso</p>
          <h2
            class="mt-2 font-display text-3xl md:text-4xl"
            [class.auth-heading-login]="authMode === 'login'"
            [class.auth-heading-signup]="authMode === 'signup'"
          >
            {{
              authMode === "login"
                ? "Bentornato nel tuo salone"
                : "Apri il tuo spazio"
            }}
          </h2>
        </div>

        <form
          class="mt-6 grid gap-4"
          [class.auth-form-login]="authMode === 'login'"
          [class.auth-form-signup]="authMode === 'signup'"
          (ngSubmit)="submit()"
        >
          <div class="auth-extra" [class.is-open]="authMode === 'signup'">
            <div class="auth-extra-inner grid gap-4">
              <div class="grid gap-4 md:grid-cols-2">
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
          <label class="field"
            ><span
              >Password
              <em class="required-mark" aria-hidden="true">*</em></span
            ><input
              [(ngModel)]="loginForm.password"
              name="loginPassword"
              type="password"
              placeholder="••••••••"
              [autocomplete]="
                authMode === 'login' ? 'current-password' : 'new-password'
              "
              minlength="8"
              required
          /></label>

          <div class="auth-extra" [class.is-open]="authMode === 'signup'">
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
                  ? "Entra nel salone"
                  : "Configura il mio salone"
            }}
          </button>
        </form>
      </section>
    </section>
  `,
})
export class AdminAuthPanelComponent implements OnChanges {
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

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["mode"]) {
      this.authMode = this.mode;
    }
  }

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

  setMode(mode: AuthMode): void {
    if (this.authMode === mode) {
      return;
    }
    this.authMode = mode;
    this.feedback = "";
    this.modeChange.emit(mode);
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
        error?.error?.message ||
        error?.message ||
        "Non siamo riusciti a completare l'accesso. Riprova.";
    } finally {
      this.loading = false;
    }
  }
}
