import { CommonModule, DOCUMENT } from "@angular/common";
import { Component, inject, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { AutofocusFirstDirective } from "../shared/autofocus-first.directive";
import { UiPageComponent } from "@alora/ui";
import { AdminPageHeaderComponent } from "../shell/admin-page-header.component";
import { canAccessLocalView, VIEW_FUNCTIONS } from "@barber/shared/functions";
import { firstValueFrom } from "rxjs";
import type { PersonalAccount, PersonalNotices, PersonalSecurity, PersonalSessionList } from "@barber/shared/account";
import { AuthApiService } from "../core/auth-api.service";
import { SessionRefreshService } from "../core/session-refresh.service";
import { SessionStore } from "../core/session.store";
import { TourService } from "../core/onboarding/tour.service";

type AccountAction = { kind: "session" | "all" | "device" | "authenticator"; id: string; current?: boolean };
type ProviderAction = "UPDATE_PASSWORD" | "CONFIGURE_TOTP" | "VERIFY_EMAIL";
const REQUIRED_ACTIONS: Record<string, string> = {
  UPDATE_PASSWORD: "nuova password",
  CONFIGURE_TOTP: "app di autenticazione",
  VERIFY_EMAIL: "verifica email",
  UPDATE_PROFILE: "dati del profilo",
  TERMS_AND_CONDITIONS: "accettazione dei termini",
};

import { AmountsPrivacyToggleComponent } from "../shared/amounts-privacy-toggle.component";
@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, UiPageComponent, AdminPageHeaderComponent, AutofocusFirstDirective, AmountsPrivacyToggleComponent],
  template: `<ui-page>
    <alora-page-header navKey="account" refreshTour="account-refresh" [refreshing]="loading || busy" (refresh)="load()">
      
    </alora-page-header>
    <p *ngIf="feedback" class="panel rounded-2xl px-4 py-3 text-sm" role="status" aria-live="polite">{{ feedback }}</p>
    <section class="grid gap-5 md:grid-cols-2">
      <article class="panel rounded-[2rem] p-5 sm:p-7" data-tour="account-profile">
        <p class="eyebrow text-[var(--accent)]">Profilo</p><h2 class="mt-1 font-display text-2xl">I tuoi dati</h2>
        <form *ngIf="account as data" class="mt-5 grid gap-3" (ngSubmit)="saveProfile()">
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="field"><span>Nome</span><input name="firstName" [(ngModel)]="profileForm.firstName" autocomplete="given-name" maxlength="100" required /></label>
            <label class="field"><span>Cognome</span><input name="lastName" [(ngModel)]="profileForm.lastName" autocomplete="family-name" maxlength="100" required /></label>
          </div>
          <div class="field"><span>Email di accesso</span><p class="break-all text-sm font-semibold">{{ data.profile.email }}</p>
            <small class="text-xs text-[var(--muted)]">È l’identità con cui entri in tutte le app EULAB: per cambiarla contatta l’amministratore.</small></div>
          <div class="flex flex-wrap gap-3">
            <button class="primary-btn" data-tour="account-profile-save" [disabled]="busy || loading || !profileChanged">{{ busy ? 'Salvataggio…' : 'Salva profilo' }}</button>
          </div>
        </form>
        <p *ngIf="errors.profile" class="mt-4 text-sm" role="status">{{ errors.profile }}</p>
        <div *ngIf="store.can('dashboard.revenue.read')" class="mt-5 border-t border-[var(--line)] pt-4">
          <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Questo dispositivo</p>
          <alora-amounts-privacy-toggle></alora-amounts-privacy-toggle>
        </div>
      </article>
      <article class="dark-panel rounded-[2rem] p-5 text-white sm:p-7" data-tour="account-security">
        <p class="eyebrow text-white/50">Protezione</p><h2 class="mt-1 font-display text-2xl">Password e verifica</h2>
        <div class="mt-5 grid gap-4 text-sm">
          <div class="flex flex-wrap items-center justify-between gap-3" data-tour="account-password">
            <div><strong>Password</strong><p class="mt-1 text-white/65">Cambiala quando vuoi: si apre la schermata sicura di EULAB e poi torni qui.</p></div>
            <button type="button" class="secondary-btn" [disabled]="busy || loading" (click)="startAction('UPDATE_PASSWORD')">Cambia password</button>
          </div>
          <ng-container *ngIf="security as data">
            <div class="flex flex-wrap items-center justify-between gap-3" data-tour="account-email">
              <div><strong>Email</strong><p class="mt-1 text-white/65">{{ data.emailVerified ? 'Verificata' : 'Non ancora verificata: serve per i codici di accesso e il recupero password.' }}</p></div>
              <button *ngIf="!data.emailVerified" type="button" class="secondary-btn" [disabled]="busy || loading" (click)="startAction('VERIFY_EMAIL')">Verifica email</button>
            </div>
            <div data-tour="account-authenticators">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div><strong>App di autenticazione</strong><p class="mt-1 text-white/65">{{ data.totp ? 'Attiva: all’accesso ti chiediamo anche il codice dell’app.' : 'Non configurata. Aggiungila per proteggere l’accesso con un codice dal telefono.' }}</p></div>
                <button type="button" class="secondary-btn" [disabled]="busy || loading" (click)="startAction('CONFIGURE_TOTP')">{{ data.totp ? 'Aggiungi un’altra app' : 'Configura app' }}</button>
              </div>
              <ul *ngIf="data.authenticators.length" class="mt-3 grid gap-2">
                <li *ngFor="let item of data.authenticators" class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/15 px-3 py-2">
                  <span>{{ item.name }}<span *ngIf="item.createdAt" class="text-white/60"> · dal {{ item.createdAt | date: 'dd/MM/yyyy' }}</span></span>
                  <button type="button" class="text-btn text-white underline" [disabled]="busy || loading" (click)="confirmAction({ kind: 'authenticator', id: item.id })">Rimuovi</button>
                </li>
              </ul>
            </div>
            <label class="field" data-tour="account-mfa-method">
              <span class="text-white/80">Metodo di verifica preferito</span>
              <select name="preferredMethod" [ngModel]="data.preferredMethod" (ngModelChange)="setPreference($event)" [disabled]="busy || loading">
                <option value="auto">Automatico</option>
                <option value="totp" [disabled]="!data.totp">App di autenticazione</option>
                <option value="email">Codice via email</option>
              </select>
              <small class="text-xs text-white/60">Vale per tutte le app EULAB. Il codice via email richiede che il servizio sia attivo per la tua organizzazione.</small>
            </label>
            <p *ngIf="data.requiredActions.length" class="rounded-2xl border border-white/20 p-3">
              Al prossimo accesso ti verrà chiesto di completare: {{ requiredActionLabels(data.requiredActions) }}.
            </p>
          </ng-container>
        </div>
        <p *ngIf="errors.security" class="mt-4 text-sm" role="status">{{ errors.security }}</p>
      </article>
    </section>
    <section class="panel rounded-[2rem] p-5 sm:p-7" data-tour="account-sessions" aria-labelledby="account-sessions">
      <div class="flex flex-wrap items-start justify-between gap-3"><div><p class="eyebrow text-[var(--accent)]">Accessi SSO</p><h2 id="account-sessions" class="mt-1 font-display text-2xl">Le mie sessioni</h2></div><button *ngIf="sessions" type="button" class="danger-btn" data-tour="account-logout-all" [disabled]="busy || loading" (click)="confirmAction({ kind: 'all', id: '' })">Disconnetti tutte</button></div>
      <p class="mt-3 text-sm text-[var(--muted)]">Le disconnessioni interessano anche le altre applicazioni EULAB associate alla sessione.</p>
      <p *ngIf="errors.sessions" class="mt-4 text-sm" role="status">{{ errors.sessions }}</p>
      <p *ngIf="sessions && !sessions.sessions.length" class="mt-4 text-sm">Nessuna sessione restituita dal provider.</p>
      <p *ngIf="sessions?.truncated" class="mt-4 text-sm">Il provider ha restituito un elenco parziale.</p>
      <article *ngFor="let item of sessions?.sessions" class="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--line)] pt-4">
        <div class="min-w-0"><strong class="text-sm">{{ item.current ? 'Questo accesso' : 'Altro accesso' }}</strong><p class="mt-1 break-all text-xs text-[var(--muted)]">{{ item.ipAddress }} · Ultima attività {{ item.lastAccess | date: 'dd/MM/yyyy HH:mm' }}</p><p class="mt-1 break-all text-xs text-[var(--muted)]">{{ item.clients.join(', ') }}</p></div>
        <button type="button" class="secondary-btn" [disabled]="busy || loading" (click)="confirmAction({ kind: 'session', id: item.id, current: item.current })">Disconnetti</button>
      </article>
    </section>
    <section class="panel rounded-[2rem] p-5 sm:p-7" data-tour="account-devices" aria-labelledby="account-devices"><p class="eyebrow text-[var(--accent)]">Browser riconosciuti</p><h2 id="account-devices" class="mt-1 font-display text-2xl">Dispositivi attendibili</h2>
      <p *ngIf="security && !security.trustedDevices.length" class="mt-4 text-sm text-[var(--muted)]">Nessun dispositivo attendibile registrato.</p>
      <p *ngIf="errors.security" class="mt-4 text-sm">Lo stato dei dispositivi non è disponibile.</p>
      <article *ngFor="let item of security?.trustedDevices" class="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--line)] pt-4"><div><strong class="text-sm">{{ item.name }}</strong><p *ngIf="item.expiresAt" class="mt-1 text-xs text-[var(--muted)]">Scadenza {{ item.expiresAt | date: 'dd/MM/yyyy HH:mm' }}</p></div><button type="button" class="danger-btn" [disabled]="busy || loading" (click)="confirmAction({ kind: 'device', id: item.id })">Revoca dispositivo</button></article>
    </section>
    <section class="panel rounded-[2rem] p-5 sm:p-7" data-tour="account-notices" aria-labelledby="account-notices"><p class="eyebrow text-[var(--accent)]">EULAB Connect</p><h2 id="account-notices" class="mt-1 font-display text-2xl">Notifiche personali recenti</h2><p class="mt-3 text-xs text-[var(--muted)]">Ultime 10 notifiche disponibili. Qui possono comparire anche gli avvisi di sicurezza generati da Connect.</p>
      <p *ngIf="errors.notices" class="mt-4 text-sm">{{ errors.notices }}</p><p *ngIf="notices && !notices.items.length" class="mt-4 text-sm text-[var(--muted)]">Nessuna notifica personale.</p>
      <article *ngFor="let item of notices?.items" class="mt-4 border-t border-[var(--line)] pt-4"><h3 class="text-sm font-semibold">{{ item.title }}</h3><p class="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--muted)]">{{ item.body }}</p><p class="mt-2 text-xs text-[var(--muted)]">{{ item.created_at | date: 'dd/MM/yyyy HH:mm' }}</p></article>
    </section>
    <section class="panel rounded-[2rem] p-5 sm:p-7" aria-labelledby="account-guides" data-tour="account-guides"><p class="eyebrow text-[var(--accent)]">Aiuto</p><h2 id="account-guides" class="mt-1 font-display text-2xl">Guide passo passo</h2>
      <p class="mt-3 text-sm text-[var(--muted)]">Le guide evidenziano i pulsanti di ogni pagina e spiegano le azioni disponibili per il tuo account.</p>
      <div class="mt-4 flex flex-wrap items-center gap-4">
        <button type="button" class="secondary-btn" data-tour="account-guides-replay" (click)="replayGuides()">Rivedi tutte le guide</button>
        <label class="field checkbox-field" data-tour="account-guides-auto"><input type="checkbox" name="toursAutoStart" [checked]="tours.autoStart()" (change)="setGuidesAutoStart($any($event.target).checked)" /><span>Apri le guide automaticamente</span></label>
      </div>
    </section>
    <div *ngIf="pending" barberAutofocusFirst class="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="account-confirm-title" (keydown)="dialogKeydown($event)">
      <article class="panel w-full max-w-lg rounded-[2rem] p-6"><h2 id="account-confirm-title" class="font-display text-2xl">{{ pending.kind === 'authenticator' ? 'Rimuovere l’app di autenticazione?' : 'Confermi la disconnessione?' }}</h2><p class="mt-3 text-sm">{{ pending.kind === 'authenticator' ? 'Non servirà più il codice di questa app. Per sicurezza verranno chiuse tutte le tue sessioni, anche nelle altre app EULAB, e dovrai accedere di nuovo.' : pending.kind === 'device' ? 'Il dispositivo perderà lo stato attendibile. Verranno richieste anche la chiusura delle sessioni SSO e una nuova autenticazione.' : pending.kind === 'all' ? 'Verranno chiuse tutte le tue sessioni SSO, incluso questo accesso, anche nelle altre applicazioni EULAB.' : 'La sessione selezionata verrà chiusa anche nelle altre applicazioni EULAB collegate.' }}</p><div class="mt-5 flex flex-wrap gap-3"><button type="button" class="danger-btn" [disabled]="busy" (click)="commit()">{{ busy ? 'Operazione in corso…' : 'Conferma' }}</button><button id="account-cancel-action" type="button" class="secondary-btn" [disabled]="busy" (click)="pending = null">Annulla</button></div></article>
    </div>
  </ui-page>`,
})
export class PersonalAccountComponent implements OnInit {
  private readonly api = inject(AuthApiService);
  readonly store = inject(SessionStore);
  private readonly refresh = inject(SessionRefreshService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  readonly tours = inject(TourService);
  account: PersonalAccount | null = null;
  security: PersonalSecurity | null = null;
  sessions: PersonalSessionList | null = null;
  notices: PersonalNotices | null = null;
  errors = { profile: "", security: "", sessions: "", notices: "" };
  loading = false;
  busy = false;
  feedback = "";
  pending: AccountAction | null = null;
  profileForm = { firstName: "", lastName: "" };
  get profileChanged(): boolean {
    const current = this.account?.profile;
    const first = this.profileForm.firstName.trim(), last = this.profileForm.lastName.trim();
    return !!current && !!first && !!last && (first !== current.firstName || last !== current.lastName);
  }
  requiredActionLabels(actions: string[]): string {
    return actions.map((action) => REQUIRED_ACTIONS[action] || action.toLowerCase()).join(", ");
  }
  async saveProfile(): Promise<void> {
    if (!this.profileChanged || this.busy) return;
    this.busy = true;
    this.feedback = "";
    try {
      const result = await firstValueFrom(this.api.updatePersonalProfile({
        firstName: this.profileForm.firstName.trim(), lastName: this.profileForm.lastName.trim(),
      }));
      if (this.account) this.account = { ...this.account, profile: result.profile };
      const user = this.store.currentUser();
      if (user) this.store.setCurrentUser({ ...user, firstName: result.profile.firstName, lastName: result.profile.lastName });
      this.feedback = "Profilo aggiornato in ALORA e nelle altre app EULAB.";
    } catch (error: any) {
      this.feedback = error?.error?.message || "Profilo non aggiornato. Riprova tra poco.";
    } finally { this.busy = false; }
  }
  async setPreference(method: PersonalSecurity["preferredMethod"]): Promise<void> {
    if (this.busy || !this.security || method === this.security.preferredMethod) return;
    this.busy = true;
    this.feedback = "";
    try {
      this.security = await firstValueFrom(this.api.setPersonalMfaPreference(method));
      this.feedback = "Metodo di verifica aggiornato.";
    } catch (error: any) {
      this.feedback = error?.error?.message || "Preferenza non salvata: il metodo potrebbe non essere attivo per la tua organizzazione.";
    } finally { this.busy = false; }
  }
  /** Opens only the secure step of the provider, then the login brings the person back here. */
  async startAction(action: ProviderAction): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.feedback = "";
    try {
      const { redirectUrl } = await firstValueFrom(this.api.startPersonalAction(action));
      this.store.rememberRequestedUrl("/account");
      this.document.location.assign(redirectUrl);
    } catch (error: any) {
      this.feedback = error?.error?.message || "Operazione non disponibile ora. Riprova tra poco.";
      this.busy = false;
    }
  }
  get workRoute(): string {
    if (this.store.currentUser()?.collaboratorId && this.store.can("appointments.read.own")) return "/my-agenda";
    return Object.keys(VIEW_FUNCTIONS).map(view => "/" + view).find(path => canAccessLocalView(this.store.currentUser(), path.slice(1))) || "/access-unavailable";
  }
  ngOnInit(): void { void this.load(); }
  confirmAction(action: AccountAction): void {
    if (this.busy || this.loading) return;
    this.pending = action;
    setTimeout(() => this.document.getElementById("account-cancel-action")?.focus());
  }
  dialogKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && !this.busy) { event.preventDefault(); this.pending = null; }
    if (event.key !== "Tab") return;
    const buttons = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const first = buttons[0], last = buttons.at(-1);
    if (!first || !last) { event.preventDefault(); return; }
    if (event.shiftKey && this.document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && this.document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  async load(): Promise<void> {
    if (this.busy || this.loading) return;
    this.loading = true;
    this.pending = null;
    this.feedback = "";
    // A failure in one provider capability must not conceal the others or reuse stale state.
    const [profile, security, sessions, notices] = await Promise.allSettled([
      firstValueFrom(this.api.personalAccount()), firstValueFrom(this.api.personalSecurity()),
      firstValueFrom(this.api.personalSessions()), firstValueFrom(this.api.personalNotices()),
    ]);
    this.account = profile.status === "fulfilled" ? profile.value : null;
    if (this.account) this.profileForm = { firstName: this.account.profile.firstName, lastName: this.account.profile.lastName };
    this.security = security.status === "fulfilled" ? security.value : null;
    this.sessions = sessions.status === "fulfilled" ? sessions.value : null;
    this.notices = notices.status === "fulfilled" ? notices.value : null;
    this.errors = {
      profile: profile.status === "rejected" ? "Profilo SSO non disponibile. Aggiorna lo stato per riprovare." : "",
      security: security.status === "rejected" ? "Sicurezza SSO non disponibile. Nessuna protezione è stata modificata." : "",
      sessions: sessions.status === "rejected" ? "Elenco sessioni non disponibile. Nessuna sessione è stata disconnessa." : "",
      notices: notices.status === "rejected" ? "Notifiche personali non disponibili." : "",
    };
    this.loading = false;
    if ([profile, security, sessions, notices].some(result => result.status === "rejected" && result.reason?.status === 401))
      await this.signedOut("session_expired");
  }
  private async signedOut(message: string): Promise<void> {
    this.store.clear();
    await this.router.navigate(["/login"], { queryParams: { accountNotice: message } });
  }
  async commit(): Promise<void> {
    const action = this.pending;
    if (!action || this.busy || this.loading) return;
    this.busy = true;
    const closesLocal = action.kind !== "session" || action.current;
    try {
      if (action.kind === "authenticator") {
        await firstValueFrom(this.api.removePersonalAuthenticator(action.id));
        await this.signedOut("authenticator_removed");
      } else if (action.kind === "device") {
        const result = await firstValueFrom(this.api.revokePersonalDevice(action.id));
        await this.signedOut(result.sessionsLoggedOut ? "device_revoked" : "device_revoked_sessions_pending");
      } else if (action.kind === "all") {
        await firstValueFrom(this.api.logoutAllPersonalSessions());
        await this.signedOut("sessions_closed");
      } else {
        const result = await firstValueFrom(this.api.logoutPersonalSession(action.id));
        if (result.current || closesLocal) await this.signedOut("session_closed");
        else { this.feedback = "Sessione disconnessa. Aggiorna lo stato per verificare gli accessi rimasti."; this.sessions = null; }
      }
    } catch (error) {
      const failure = (error || {}) as { status?: number; error?: { code?: string } };
      if (action.kind === "authenticator" && [400, 403, 404].includes(failure.status || 0)) {
        this.security = null;
        this.feedback = "App non rimossa: aggiorna lo stato e riprova. L’accesso è conservato.";
      } else if (action.kind === "device" && ([403, 404].includes(failure.status || 0) || failure.error?.code === "account_operation_not_started")) {
        this.security = null;
        this.feedback = "Operazione non eseguita. Aggiorna lo stato dei dispositivi prima di riprovare; l’accesso è conservato.";
      } else if (closesLocal) await this.signedOut("outcome_unknown");
      else { this.sessions = null; this.feedback = "Esito da verificare. Aggiorna lo stato prima di riprovare; l’operazione non è stata ripetuta."; }
    } finally { this.pending = null; this.busy = false; }
  }
  /** Re-enables every guide and replays the general tour from the start. */
  replayGuides(): void {
    this.tours.resetSeen();
    this.tours.start(null);
  }
  setGuidesAutoStart(enabled: boolean): void { this.tours.setAutoStart(enabled); }
  logout(): void { this.refresh.logout(); void this.router.navigateByUrl("/login"); }
}
