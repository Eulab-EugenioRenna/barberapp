import { CommonModule, DOCUMENT } from "@angular/common";
import { Component, inject, OnInit } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { AutofocusFirstDirective } from "../shared/autofocus-first.directive";
import { AloraBrandComponent } from "@barber/shared/brand";
import { canAccessLocalView, VIEW_FUNCTIONS } from "@barber/shared/functions";
import { firstValueFrom } from "rxjs";
import type { PersonalAccount, PersonalNotices, PersonalSecurity, PersonalSessionList } from "@barber/shared/account";
import { AuthApiService } from "../core/auth-api.service";
import { SessionRefreshService } from "../core/session-refresh.service";
import { SessionStore } from "../core/session.store";

type AccountAction = { kind: "session" | "all" | "device"; id: string; current?: boolean };

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink, AloraBrandComponent, AutofocusFirstDirective],
  template: `<main class="mx-auto grid max-w-5xl gap-5 p-4 pb-10 sm:p-7">
    <header class="panel rounded-[2rem] p-5 sm:p-7">
      <div class="flex flex-wrap items-center justify-between gap-4"><alora-brand></alora-brand>
        <nav class="flex flex-wrap gap-2" aria-label="Navigazione personale"><a class="secondary-btn" [routerLink]="workRoute">Torna al lavoro</a><button class="secondary-btn" type="button" (click)="logout()">Esci</button></nav>
      </div>
      <p class="eyebrow mt-6 text-[var(--accent)]">Accesso personale</p>
      <h1 class="mt-1 font-display text-3xl sm:text-4xl">Il mio account</h1>
      <p class="mt-3 max-w-2xl text-sm text-[var(--muted)]">La tua identità EULAB ti accompagna nelle applicazioni collegate. Qui controlli la sicurezza del tuo accesso.</p>
      <button type="button" class="secondary-btn mt-4" [disabled]="loading || busy" (click)="load()">{{ loading ? 'Aggiornamento…' : 'Aggiorna stato' }}</button>
      <p *ngIf="feedback" class="mt-4 text-sm" role="status" aria-live="polite">{{ feedback }}</p>
    </header>
    <section class="grid gap-5 md:grid-cols-2">
      <article class="panel rounded-[2rem] p-5 sm:p-7">
        <p class="eyebrow text-[var(--accent)]">Profilo</p><h2 class="mt-1 font-display text-2xl">I tuoi dati in ALORA</h2>
        <ng-container *ngIf="account as data"><p class="mt-5 text-xl font-semibold">{{ data.profile.firstName }} {{ data.profile.lastName }}</p><p class="mt-1 break-all text-sm text-[var(--muted)]">{{ data.profile.email }}</p>
          <a class="primary-btn mt-5 inline-flex" [href]="data.accountUrl" target="_blank" rel="noopener noreferrer">Gestisci profilo e sicurezza SSO ↗</a>
          <p class="mt-3 text-xs text-[var(--muted)]">Si apre l’area account EULAB. Puoi modificare i dati consentiti dal provider, cambiare password e configurare l’autenticatore. Le modifiche al profilo SSO non cambiano automaticamente l’anagrafica operativa del salone.</p>
        </ng-container>
        <p *ngIf="errors.profile" class="mt-4 text-sm" role="status">{{ errors.profile }}</p>
        <p class="mt-5 text-sm text-[var(--muted)]">Password dimenticata? Usa il recupero password nella schermata di accesso SSO. Il link viene gestito dal provider.</p>
      </article>
      <article class="dark-panel rounded-[2rem] p-5 text-white sm:p-7">
        <p class="eyebrow text-white/50">Protezione</p><h2 class="mt-1 font-display text-2xl">Password e autenticazione</h2>
        <dl *ngIf="security as data" class="mt-5 grid gap-4 text-sm">
          <div><dt class="text-white/60">App autenticatore</dt><dd class="mt-1 font-semibold">{{ data.totp ? 'Configurata' : 'Non configurata' }}</dd></div>
          <div><dt class="text-white/60">Indirizzo email</dt><dd class="mt-1 font-semibold">{{ data.emailVerified ? 'Verificato dal provider' : 'Da verificare nel provider' }}</dd></div>
          <div><dt class="text-white/60">Preferenza registrata in Connect</dt><dd class="mt-1">{{ data.preferredMethod === 'auto' ? 'Automatica' : data.preferredMethod === 'totp' ? 'App autenticatore' : 'Codice email' }}</dd></div>
        </dl>
        <p *ngIf="security?.requiredActions?.length" class="mt-4 text-sm">Il provider richiede di completare alcune operazioni. Apri l’area account SSO.</p>
        <p *ngIf="errors.security" class="mt-4 text-sm" role="status">{{ errors.security }}</p>
        <p class="mt-5 text-xs text-white/65">Configura l’app autenticatore nell’area account SSO. Codici email, preferenze MFA e dispositivi attendibili estesi richiedono l’attivazione del flusso di sicurezza EULAB. Una preferenza registrata non prova che il metodo sia attivo.</p>
      </article>
    </section>
    <section class="panel rounded-[2rem] p-5 sm:p-7" aria-labelledby="account-sessions">
      <div class="flex flex-wrap items-start justify-between gap-3"><div><p class="eyebrow text-[var(--accent)]">Accessi SSO</p><h2 id="account-sessions" class="mt-1 font-display text-2xl">Le mie sessioni</h2></div><button *ngIf="sessions" type="button" class="danger-btn" [disabled]="busy || loading" (click)="confirmAction({ kind: 'all', id: '' })">Disconnetti tutte</button></div>
      <p class="mt-3 text-sm text-[var(--muted)]">Le disconnessioni interessano anche le altre applicazioni EULAB associate alla sessione.</p>
      <p *ngIf="errors.sessions" class="mt-4 text-sm" role="status">{{ errors.sessions }}</p>
      <p *ngIf="sessions && !sessions.sessions.length" class="mt-4 text-sm">Nessuna sessione restituita dal provider.</p>
      <p *ngIf="sessions?.truncated" class="mt-4 text-sm">Il provider ha restituito un elenco parziale.</p>
      <article *ngFor="let item of sessions?.sessions" class="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--line)] pt-4">
        <div class="min-w-0"><strong class="text-sm">{{ item.current ? 'Questo accesso' : 'Altro accesso' }}</strong><p class="mt-1 break-all text-xs text-[var(--muted)]">{{ item.ipAddress }} · Ultima attività {{ item.lastAccess | date: 'dd/MM/yyyy HH:mm' }}</p><p class="mt-1 break-all text-xs text-[var(--muted)]">{{ item.clients.join(', ') }}</p></div>
        <button type="button" class="secondary-btn" [disabled]="busy || loading" (click)="confirmAction({ kind: 'session', id: item.id, current: item.current })">Disconnetti</button>
      </article>
    </section>
    <section class="panel rounded-[2rem] p-5 sm:p-7" aria-labelledby="account-devices"><p class="eyebrow text-[var(--accent)]">Browser riconosciuti</p><h2 id="account-devices" class="mt-1 font-display text-2xl">Dispositivi attendibili</h2>
      <p *ngIf="security && !security.trustedDevices.length" class="mt-4 text-sm text-[var(--muted)]">Nessun dispositivo attendibile registrato.</p>
      <p *ngIf="errors.security" class="mt-4 text-sm">Lo stato dei dispositivi non è disponibile.</p>
      <article *ngFor="let item of security?.trustedDevices" class="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--line)] pt-4"><div><strong class="text-sm">{{ item.name }}</strong><p *ngIf="item.expiresAt" class="mt-1 text-xs text-[var(--muted)]">Scadenza {{ item.expiresAt | date: 'dd/MM/yyyy HH:mm' }}</p></div><button type="button" class="danger-btn" [disabled]="busy || loading" (click)="confirmAction({ kind: 'device', id: item.id })">Revoca dispositivo</button></article>
    </section>
    <section class="panel rounded-[2rem] p-5 sm:p-7" aria-labelledby="account-notices"><p class="eyebrow text-[var(--accent)]">EULAB Connect</p><h2 id="account-notices" class="mt-1 font-display text-2xl">Notifiche personali recenti</h2><p class="mt-3 text-xs text-[var(--muted)]">Ultime 10 notifiche disponibili. Qui possono comparire anche gli avvisi di sicurezza generati da Connect.</p>
      <p *ngIf="errors.notices" class="mt-4 text-sm">{{ errors.notices }}</p><p *ngIf="notices && !notices.items.length" class="mt-4 text-sm text-[var(--muted)]">Nessuna notifica personale.</p>
      <article *ngFor="let item of notices?.items" class="mt-4 border-t border-[var(--line)] pt-4"><h3 class="text-sm font-semibold">{{ item.title }}</h3><p class="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--muted)]">{{ item.body }}</p><p class="mt-2 text-xs text-[var(--muted)]">{{ item.created_at | date: 'dd/MM/yyyy HH:mm' }}</p></article>
    </section>
    <div *ngIf="pending" barberAutofocusFirst class="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="account-confirm-title" (keydown)="dialogKeydown($event)">
      <article class="panel w-full max-w-lg rounded-[2rem] p-6"><h2 id="account-confirm-title" class="font-display text-2xl">Confermi la disconnessione?</h2><p class="mt-3 text-sm">{{ pending.kind === 'device' ? 'Il dispositivo perderà lo stato attendibile. Verranno richieste anche la chiusura delle sessioni SSO e una nuova autenticazione.' : pending.kind === 'all' ? 'Verranno chiuse tutte le tue sessioni SSO, incluso questo accesso, anche nelle altre applicazioni EULAB.' : 'La sessione selezionata verrà chiusa anche nelle altre applicazioni EULAB collegate.' }}</p><div class="mt-5 flex flex-wrap gap-3"><button type="button" class="danger-btn" [disabled]="busy" (click)="commit()">{{ busy ? 'Operazione in corso…' : 'Conferma' }}</button><button id="account-cancel-action" type="button" class="secondary-btn" [disabled]="busy" (click)="pending = null">Annulla</button></div></article>
    </div>
  </main>`,
})
export class PersonalAccountComponent implements OnInit {
  private readonly api = inject(AuthApiService);
  private readonly store = inject(SessionStore);
  private readonly refresh = inject(SessionRefreshService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  account: PersonalAccount | null = null;
  security: PersonalSecurity | null = null;
  sessions: PersonalSessionList | null = null;
  notices: PersonalNotices | null = null;
  errors = { profile: "", security: "", sessions: "", notices: "" };
  loading = false;
  busy = false;
  feedback = "";
  pending: AccountAction | null = null;
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
      if (action.kind === "device") {
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
      if (action.kind === "device" && ([403, 404].includes(failure.status || 0) || failure.error?.code === "account_operation_not_started")) {
        this.security = null;
        this.feedback = "Operazione non eseguita. Aggiorna lo stato dei dispositivi prima di riprovare; l’accesso è conservato.";
      } else if (closesLocal) await this.signedOut("outcome_unknown");
      else { this.sessions = null; this.feedback = "Esito da verificare. Aggiorna lo stato prima di riprovare; l’operazione non è stata ripetuta."; }
    } finally { this.pending = null; this.busy = false; }
  }
  logout(): void { this.refresh.logout(); void this.router.navigateByUrl("/login"); }
}
