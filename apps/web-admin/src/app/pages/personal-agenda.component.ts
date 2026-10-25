import { AloraBrandComponent } from "@barber/shared/brand";
import { CommonModule } from "@angular/common";
import { Component, inject, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { PERSONAL_STATUS_TRANSITIONS } from "@barber/shared/personal";
import type { PersonalAppointment, PersonalDashboard } from "@barber/shared/personal";
import { AdminApiService } from "../core/admin-api.service";
import { SessionRefreshService } from "../core/session-refresh.service";
import { SessionStore } from "../core/session.store";
@Component({
  standalone: true,
  imports: [CommonModule, AloraBrandComponent, FormsModule],
  template: `<main class="mx-auto grid max-w-6xl gap-5 p-4 pb-10 sm:p-7">
    <header class="panel rounded-[2rem] p-5 sm:p-7">
      <div class="flex flex-wrap items-center justify-between gap-4"><alora-brand></alora-brand><button class="secondary-btn" type="button" (click)="logout()">Esci</button></div>
      <p class="eyebrow mt-6 text-[var(--accent)]">Il mio lavoro</p>
      <h1 class="mt-1 font-display text-3xl sm:text-4xl">La mia agenda</h1>
      <p *ngIf="data" class="mt-2 text-sm opacity-75">{{ data.professional.firstName }} {{ data.professional.lastName }} · Orari {{ data.timezone }}</p>
      <form class="mt-5 flex flex-wrap items-end gap-3" (ngSubmit)="load(false, true)">
        <label class="field"><span>Periodo</span><select name="period" [(ngModel)]="period" [disabled]="loading || !!updatingId"><option value="day">Giorno</option><option value="week">Settimana</option><option value="month">Mese</option></select></label>
        <label class="field"><span>Data di riferimento</span><input type="date" name="referenceDate" [(ngModel)]="referenceDate" [disabled]="loading || !!updatingId" /></label>
        <button class="primary-btn" type="submit" [disabled]="loading || !!updatingId">Mostra</button>
        <button class="secondary-btn" type="button" [disabled]="loading || !!updatingId" (click)="today()">Oggi</button>
        <button class="secondary-btn" type="button" [disabled]="loading || !!updatingId" (click)="load()">Aggiorna</button>
      </form>
      <p *ngIf="loading" class="mt-4 text-sm" role="status">Caricamento delle tue attività…</p>
      <p *ngIf="feedback" class="mt-4 text-sm" role="status" aria-live="polite">{{ feedback }}</p>
    </header>
    <ng-container *ngIf="data as dashboard">
      <section class="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Le mie attività nel periodo">
        <article class="panel rounded-3xl p-5"><p class="eyebrow">Appuntamenti</p><strong class="mt-2 block font-display text-3xl">{{ dashboard.activity.totalAppointments }}</strong></article>
        <article class="panel rounded-3xl p-5"><p class="eyebrow">Completati</p><strong class="mt-2 block font-display text-3xl">{{ dashboard.activity.completedAppointments }}</strong></article>
        <article class="panel rounded-3xl p-5"><p class="eyebrow">Servizi attribuiti</p><strong class="mt-2 block font-display text-3xl">{{ dashboard.activity.attributedServices }}</strong><p class="mt-1 text-xs opacity-65">Nei conti registrati nel periodo</p></article>
        <article class="panel rounded-3xl p-5"><p class="eyebrow">Assenze / annullati</p><strong class="mt-2 block font-display text-3xl">{{ dashboard.activity.noShows }} / {{ dashboard.activity.cancelledAppointments }}</strong></article>
      </section>
      <article *ngIf="dashboard.values as values" class="panel rounded-3xl p-5"><p class="eyebrow">Valore registrato dei tuoi servizi</p><strong class="mt-2 block font-display text-3xl">{{ values.registeredServiceLineTotal | currency: values.currency }}</strong><p class="mt-2 text-sm opacity-75">Somma delle righe servizio attribuite a te, prima di eventuali sconti sul conto. Sono esclusi i servizi senza un conto registrato. Non indica incassi o compensi.</p></article>
      <section class="panel rounded-[2rem] p-5 sm:p-6" aria-labelledby="personal-appointments-title">
        <div class="flex flex-wrap items-center justify-between gap-3"><h2 id="personal-appointments-title" class="font-display text-2xl">Appuntamenti assegnati</h2><span class="text-sm opacity-70">{{ dashboard.appointments.total }} nel periodo</span></div>
        <p *ngIf="!dashboard.appointments.items.length" class="py-8 text-sm opacity-75">Nessun appuntamento assegnato in questo periodo.</p>
        <article *ngFor="let item of dashboard.appointments.items" class="mt-4 rounded-3xl border border-current/10 p-4 sm:p-5">
          <div class="flex flex-wrap justify-between gap-3"><div><p class="text-sm text-[var(--accent)]">{{ dateTime(item.startsAt) }} – {{ time(item.endsAt) }}</p><h3 class="mt-1 font-display text-xl">{{ item.service.name }}</h3><p class="mt-1 text-sm">{{ item.customer.firstName }} {{ item.customer.lastName }}</p><p *ngIf="item.customer.phone" class="mt-1 text-sm opacity-70">{{ item.customer.phone }}</p></div><span class="status-pill status-pill-neutral self-start">{{ statusLabel(item.status) }}</span></div>
          <p *ngIf="item.customerNotes" class="mt-3 whitespace-pre-wrap text-sm opacity-75">{{ item.customerNotes }}</p>
          <p *ngIf="item.room" class="mt-2 text-xs opacity-65">{{ item.room.name }}</p>
          <div *ngIf="canUpdate" class="mt-3 flex flex-wrap gap-2"><button *ngFor="let next of transitions(item)" type="button" class="secondary-btn" [disabled]="!!updatingId || loading" (click)="pending = { id: item.id, status: next }">{{ actionLabel(next) }}</button></div>
          <div *ngIf="pending?.id === item.id" class="mt-4 border-t border-current/10 pt-3"><p class="text-sm">Confermare lo stato «{{ statusLabel(pending!.status) }}»?</p><div class="mt-2 flex gap-2"><button type="button" class="primary-btn" [disabled]="!!updatingId" (click)="commitStatus()">Conferma</button><button type="button" class="secondary-btn" [disabled]="!!updatingId" (click)="pending = null">Annulla</button></div></div>
        </article>
        <nav *ngIf="dashboard.appointments.total > dashboard.appointments.pageSize" class="mt-5 flex items-center justify-between gap-3" aria-label="Pagine degli appuntamenti"><button type="button" class="secondary-btn" [disabled]="page <= 1 || loading || !!updatingId" (click)="changePage(-1)">Precedenti</button><span class="text-sm">Pagina {{ page }}</span><button type="button" class="secondary-btn" [disabled]="!dashboard.appointments.hasMore || loading || !!updatingId" (click)="changePage(1)">Successivi</button></nav>
      </section>
    </ng-container>
  </main>`,
})
export class PersonalAgendaComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly session = inject(SessionRefreshService);
  private readonly store = inject(SessionStore);
  private readonly router = inject(Router);
  data: PersonalDashboard | null = null;
  period: "day" | "week" | "month" = "week";
  referenceDate = "";
  page = 1;
  loading = false;
  updatingId = "";
  pending: { id: string; status: string } | null = null;
  feedback = "";
  get canUpdate(): boolean { return this.store.can("appointments.update.all") || this.store.can("appointments.update.own"); }
  ngOnInit(): void { void this.load(); }
  async load(preserveFeedback = false, resetPage = false): Promise<void> {
    if (resetPage) this.page = 1;
    this.loading = true;
    this.pending = null;
    if (!preserveFeedback) this.feedback = "";
    try {
      this.data = await firstValueFrom(this.api.loadPersonalDashboard(this.period, this.referenceDate, this.page));
      this.referenceDate = this.data.referenceDate;
    } catch {
      this.data = null;
      this.feedback = "La tua agenda non è disponibile. Verifica l’associazione e i permessi con il titolare, oppure aggiorna la pagina.";
    } finally { this.loading = false; }
  }
  today(): void { this.referenceDate = ""; void this.load(false, true); }
  changePage(delta: number): void { this.page += delta; void this.load(); }
  transitions(item: PersonalAppointment): readonly string[] { return PERSONAL_STATUS_TRANSITIONS[item.status] || []; }
  statusLabel(status: string): string { return ({ draft: "Bozza", requested: "Da confermare", confirmed: "Confermato", checked_in: "In corso", completed: "Completato", cancelled: "Annullato", no_show: "Assente", rescheduled: "Riprogrammato" } as Record<string, string>)[status] || status; }
  actionLabel(status: string): string { return ({ confirmed: "Conferma prenotazione", checked_in: "Segna arrivo", completed: "Completa servizio", no_show: "Segna assenza" } as Record<string, string>)[status] || this.statusLabel(status); }
  dateTime(value: string): string { return new Intl.DateTimeFormat("it-IT", { timeZone: this.data?.timezone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
  time(value: string): string { return new Intl.DateTimeFormat("it-IT", { timeZone: this.data?.timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
  async commitStatus(): Promise<void> {
    const pending = this.pending;
    const item = this.data?.appointments.items.find(item => item.id === pending?.id);
    if (!pending || !item || !this.canUpdate || this.updatingId || !this.transitions(item).includes(pending.status)) return;
    this.updatingId = pending.id;
    try {
      await firstValueFrom(this.api.updatePersonalAppointmentStatus(pending.id, pending.status));
      this.feedback = "Stato aggiornato.";
      await this.load(true);
    } catch { this.pending = null; this.feedback = "Esito da verificare. Premi Aggiorna prima di riprovare; la modifica non è stata ripetuta automaticamente."; }
    finally { this.updatingId = ""; }
  }
  logout(): void { this.session.logout(); void this.router.navigateByUrl("/login"); }
}
