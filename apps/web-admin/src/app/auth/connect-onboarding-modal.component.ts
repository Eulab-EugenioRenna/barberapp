import {
  AfterViewInit,
  OnInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { AloraBrandComponent } from "@barber/shared/brand";

export interface ConnectOnboardingProfile {
  version: string;
  firstName: string;
  lastName: string;
  email: string;
  challenge: string;
  feedback?: string;
  needsLegacyVerification?: boolean;
  request?: { requestId: string; state: string; nextAction?: string };
}
// Connect remains authoritative about whether the practice is still open.
// Other terminal/error states need explicit retry information from its contract.
export function canRequestConnectMigration(
  profile: ConnectOnboardingProfile,
): boolean {
  return (
    !!profile.challenge &&
    (!profile.request ||
      ["resubmit", "choose_connect_password"].includes(
        profile.request.nextAction ?? "",
      ) ||
      (!profile.request.nextAction && profile.request.state === "expired"))
  );
}

@Component({
  selector: "alora-connect-onboarding-modal",
  standalone: true,
  imports: [CommonModule, FormsModule, AloraBrandComponent],
  styles: [
    `
      dialog {
        width: min(36rem, calc(100vw - 2rem));
        max-height: calc(100dvh - 2rem);
        border: 1px solid var(--line);
        border-radius: 1.75rem;
        padding: 0;
        background: var(--alora-paper);
        color: var(--ink);
        box-shadow: 0 2rem 6rem #10231833;
      }
      dialog::backdrop {
        background: #10231899;
        backdrop-filter: blur(5px);
      }
      .onboarding-header {
        background: var(--alora-forest);
        padding: 1.6rem 1.75rem;
        color: white;
      }
      .onboarding-body {
        padding: 1.75rem;
      }
      .onboarding-step {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        color: var(--alora-lime);
        font-size: 0.7rem;
        letter-spacing: 0.13em;
        text-transform: uppercase;
        margin-top: 1.2rem;
      }
      .onboarding-step::before {
        content: "";
        width: 0.45rem;
        height: 0.45rem;
        background: currentColor;
        border-radius: 50%;
      }
      .consent {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        border: 1px solid var(--line);
        border-radius: 1rem;
        padding: 1rem;
        font-size: 0.875rem;
        line-height: 1.5;
        background: white;
      }
      .consent input {
        accent-color: var(--alora-forest);
        width: 1.1rem;
        height: 1.1rem;
        flex-shrink: 0;
        margin-top: 0.13rem;
      }
      .onboarding-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.65rem;
        justify-content: flex-end;
        margin-top: 1.25rem;
      }
      @media (max-width: 480px) {
        .onboarding-header,
        .onboarding-body {
          padding: 1.25rem;
        }
        .onboarding-actions > button {
          flex: 1 1 100%;
        }
      }
    `,
  ],
  template: `
    <dialog
      role="dialog"
      aria-modal="true"
      #dialog
      aria-labelledby="connect-onboarding-title"
      aria-describedby="connect-onboarding-description"
      (cancel)="cancelDialog($event)"
    >
      <header class="onboarding-header">
        <alora-brand [onDark]="true"></alora-brand>
        <span class="onboarding-step">Aggiornamento dell’accesso</span>
        <h2
          id="connect-onboarding-title"
          class="mt-3 text-3xl font-semibold leading-tight"
        >
          Il tuo profilo,<br />un accesso unico.
        </h2>
      </header>
      <form
        *ngIf="!profile.needsLegacyVerification"
        class="onboarding-body grid gap-4"
        #profileForm="ngForm"
        (ngSubmit)="confirm()"
      >
        <p
          id="connect-onboarding-description"
          class="text-sm leading-relaxed text-[var(--muted)]"
        >
          Per accedere ad ALORA è necessario passare a EULAB Connect. Invia la
          richiesta: EULAB verificherà e approverà la migrazione della tua
          attività.
        </p>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="field"
            ><span>Nome</span
            ><input
              name="connectFirstName"
              [(ngModel)]="firstName"
              autocomplete="given-name"
              maxlength="80"
              required
              readonly
              [disabled]="loading || !canSubmitRequest"
          /></label>
          <label class="field"
            ><span>Cognome</span
            ><input
              name="connectLastName"
              [(ngModel)]="lastName"
              autocomplete="family-name"
              maxlength="80"
              required
              readonly
              [disabled]="loading || !canSubmitRequest"
          /></label>
        </div>
        <label class="field"
          ><span>Email del tuo account</span
          ><input
            name="connectEmail"
            [value]="profile.email"
            type="email"
            readonly
            aria-describedby="connect-email-note"
        /></label>
        <p id="connect-email-note" class="text-xs text-[var(--muted)]">
          L’email identifica il tuo account esistente.
        </p>
        <p
          *ngIf="!needsNewPassword"
          class="text-sm leading-relaxed text-[var(--muted)]"
        >
          La password verificata viene inviata al servizio di migrazione
          Connect, che la custodisce cifrata e temporaneamente fino
          all’approvazione. Per una nuova identità potrai continuare a usare la
          stessa password. Un account Connect già esistente richiede un
          collegamento esplicito.
        </p>
        <div *ngIf="needsNewPassword && canSubmitRequest" class="grid gap-3">
          <p class="text-sm leading-relaxed text-[var(--muted)]">
            La password locale non soddisfa i requisiti di Connect. Scegli una
            password diversa per Connect: quella locale resta invariata e serve
            solo a verificare questa richiesta. EULAB dovrà approvare nuovamente
            l’attivazione.
          </p>
          <label class="field"
            ><span>Nuova password Connect</span
            ><input
              name="newConnectPassword"
              type="password"
              [(ngModel)]="newConnectPassword"
              autocomplete="new-password"
              minlength="8"
              maxlength="512"
              required
              [disabled]="loading"
          /></label>
          <label class="field"
            ><span>Conferma nuova password Connect</span
            ><input
              name="confirmConnectPassword"
              type="password"
              [(ngModel)]="confirmConnectPassword"
              autocomplete="new-password"
              minlength="8"
              maxlength="512"
              required
              [disabled]="loading"
          /></label>
        </div>
        <label class="consent" *ngIf="canSubmitRequest"
          ><input
            name="connectConsent"
            type="checkbox"
            [(ngModel)]="accepted"
            [disabled]="loading || !canSubmitRequest"
            required
          /><span>{{
            needsNewPassword
              ? "Confermo i dati e richiedo l’attivazione con la nuova password Connect, inviata in modo protetto."
              : "Confermo i dati e richiedo la migrazione a EULAB Connect, incluso il trasferimento protetto della password per l’attivazione."
          }}</span></label
        >
        <p
          *ngIf="feedback"
          role="alert"
          class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {{ feedback }}
        </p>
        <div
          *ngIf="profile.request"
          role="status"
          class="rounded-xl border border-[var(--line)] bg-white p-4 text-sm"
        >
          <p>Pratica {{ profile.request.requestId }} — {{ requestState }}</p>
          <p class="mt-2">{{ requestMessage }}</p>
        </div>
        <div class="onboarding-actions">
          <button
            type="submit"
            class="primary-btn"
            [disabled]="
              loading ||
              !canSubmitRequest ||
              !profileForm.valid ||
              !accepted ||
              !firstName.trim() ||
              !lastName.trim() ||
              (needsNewPassword &&
                (newConnectPassword.length < 8 ||
                  newConnectPassword !== confirmConnectPassword))
            "
          >
            {{ loading ? "Invio in corso…" : "Invia richiesta" }}
          </button>
        </div>
      </form>
      <form *ngIf="profile.needsLegacyVerification" class="onboarding-body grid gap-4"
        (ngSubmit)="verifyLocal()">
        <p class="text-sm text-[var(--muted)]">Se possiedi un account locale da migrare,
          verifica la vecchia password per preparare la richiesta a Connect.
          L’accesso resta bloccato fino all’approvazione EULAB.</p>
        <p class="text-sm">{{ profile.email }}</p>
        <label class="field"><span>Password dell’account locale</span>
          <input name="legacyPassword" [(ngModel)]="localPassword" type="password"
            autocomplete="current-password" required [disabled]="loading" /></label>
        <p *ngIf="feedback" role="alert" class="text-sm">{{ feedback }}</p>
        <button type="submit" class="primary-btn" [disabled]="loading || !localPassword">
          {{ loading ? "Verifica in corso…" : "Verifica account locale" }}
        </button>
      </form>
    </dialog>
  `,
})
export class ConnectOnboardingModalComponent
  implements AfterViewInit, OnInit, OnDestroy, OnChanges
{
  @Input({ required: true }) profile!: ConnectOnboardingProfile;
  @Input() loading = false;
  @Input() feedback = "";
  @Output() verifyLegacy = new EventEmitter<string>();
  localPassword = "";
  verifyLocal(): void {
    if (this.loading || !this.localPassword) return;
    const password = this.localPassword;
    this.localPassword = "";
    this.verifyLegacy.emit(password);
  }
  @Output() accept = new EventEmitter<{
    firstName: string;
    lastName: string;
    newConnectPassword?: string;
  }>();
  @ViewChild("dialog", { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  firstName = "";
  lastName = "";
  accepted = false;
  newConnectPassword = "";
  confirmConnectPassword = "";
  get needsNewPassword(): boolean {
    return this.profile.request?.nextAction === "choose_connect_password";
  }
  get canSubmitRequest(): boolean {
    return canRequestConnectMigration(this.profile);
  }
  get requestState(): string {
    return (
      (
        {
          pending: "In attesa di approvazione",
          approved: "Approvata",
          migrating: "Migrazione in corso",
          completed: "Migrazione completata",
          rejected: "Non approvata",
          expired: "Scaduta",
          failed: "Da verificare",
        } as Record<string, string>
      )[this.profile.request?.state ?? ""] ?? "Da verificare"
    );
  }
  get requestMessage(): string {
    if (this.needsNewPassword)
      return "Serve una nuova password Connect. Se la verifica locale è scaduta, ricarica e ripeti Accedi con la password locale prima di inviare.";
    if (this.profile.request?.state === "expired" && this.canSubmitRequest)
      return "La richiesta è scaduta. Conferma nuovamente il consenso e premi Invia richiesta per ripresentarla. L’accesso al gestionale resta bloccato fino all’approvazione.";
    return this.profile.request?.state === "completed"
      ? "Ricarica la pagina e premi Accedi per continuare con Connect."
      : "L’accesso al gestionale resta bloccato. Ripeti l’accesso per verificare lo stato; per assistenza contatta EULAB indicando la pratica.";
  }
  ngOnInit(): void {
    this.firstName = this.profile.firstName;
    this.lastName = this.profile.lastName;
  }
  ngAfterViewInit(): void {
    this.dialog.nativeElement.showModal();
  }
  ngOnDestroy(): void {
    this.clearNewPassword();
  }
  private clearNewPassword(): void {
    this.localPassword = "";
    this.newConnectPassword = "";
    this.confirmConnectPassword = "";
  }
  ngOnChanges(changes: SimpleChanges): void {
    const change = changes["profile"];
    if (
      change &&
      change.previousValue?.challenge !== change.currentValue?.challenge
    ) {
      this.clearNewPassword();
      this.accepted = false;
      this.firstName = this.profile.firstName;
      this.lastName = this.profile.lastName;
    }
  }
  confirm(): void {
    if (
      !this.loading &&
      this.canSubmitRequest &&
      this.accepted &&
      this.firstName.trim() &&
      this.lastName.trim() &&
      (!this.needsNewPassword ||
        (this.newConnectPassword.length >= 8 &&
          this.newConnectPassword === this.confirmConnectPassword))
    ) {
      this.accept.emit({
        firstName: this.firstName.trim(),
        lastName: this.lastName.trim(),
        ...(this.needsNewPassword
          ? { newConnectPassword: this.newConnectPassword }
          : {}),
      });
      this.clearNewPassword();
    }
  }
  cancelDialog(event: Event): void {
    event.preventDefault();
  }
}
