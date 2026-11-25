import { CalendarInputComponent } from "../calendar-input.component";
import { UiPageComponent, UiSelectComponent, type UiOption } from "@alora/ui";
import { AdminPageHeaderComponent } from "../shell/admin-page-header.component";
import { CommonModule } from "@angular/common";
import { Component, inject, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { PERSONAL_STATUS_TRANSITIONS } from "@barber/shared/personal";
import type { PersonalAppointment, PersonalDashboard } from "@barber/shared/personal";
import { AdminApiService } from "../core/admin-api.service";
import { SessionRefreshService } from "../core/session-refresh.service";
import { SessionStore } from "../core/session.store";
import { PersonalBookingComponent } from "./personal-booking.component";
@Component({
  standalone: true,
  imports: [CalendarInputComponent, CommonModule, FormsModule, RouterLink, PersonalBookingComponent, UiPageComponent, UiSelectComponent, AdminPageHeaderComponent],
  template: `<ui-page>
    <alora-page-header
      navKey="my-agenda"
      [titleOverride]="collaboratorId ? (data ? 'Agenda di ' + data.professional.firstName + ' ' + data.professional.lastName : 'Agenda del profilo') : ''"
    >
      <a uiPageActions *ngIf="collaboratorId && canOpenCompany" class="secondary-btn" data-tour="my-agenda-back" [routerLink]="companyRoute">Torna alla squadra</a>
      <button uiPageActions *ngIf="canBook && !booking" type="button" class="primary-btn" data-tour="my-agenda-new" (click)="booking = true; feedback = ''">Nuovo appuntamento</button>
    </alora-page-header>
    <alora-personal-booking *ngIf="booking && canBook" [collaboratorId]="ownCollaboratorId" (closed)="booking = false" (booked)="onBooked()"></alora-personal-booking>
    <section class="panel rounded-[2rem] p-5 sm:p-6" aria-label="Periodo">
      <p *ngIf="data" class="text-sm opacity-75">{{ data.professional.firstName }} {{ data.professional.lastName }} · Orari {{ data.timezone }}</p>
      <form class="mt-3 flex flex-wrap items-end gap-3" data-tour="my-agenda-period" (ngSubmit)="load(false, true)">
        <div class="field"><span>Periodo</span><ui-select name="period" label="Periodo" [options]="periodOptions" [filterable]="false" [(ngModel)]="period" [disabled]="loading || !!updatingId"></ui-select></div>
        <div class="field"><span>Data di riferimento</span><barber-calendar-input compact label="Data di riferimento" [value]="referenceDate" (valueChange)="referenceDate = $event" [disabled]="loading || !!updatingId"></barber-calendar-input></div>
        <button class="primary-btn" type="submit" [disabled]="loading || !!updatingId">Mostra</button>
        <button class="secondary-btn" type="button" data-tour="my-agenda-today" [disabled]="loading || !!updatingId" (click)="today()">Oggi</button>
        <button class="secondary-btn" type="button" data-tour="my-agenda-refresh" [disabled]="loading || !!updatingId" (click)="load()">Aggiorna</button>
      </form>
      <p *ngIf="loading" class="mt-4 text-sm" role="status">Caricamento delle attività…</p>
      <p *ngIf="feedback" class="mt-4 text-sm" role="status" aria-live="polite">{{ feedback }}</p>
    </section>
    <ng-container *ngIf="data as dashboard">
      <section class="grid grid-cols-2 gap-3 lg:grid-cols-4" data-tour="my-agenda-stats" aria-label="Attività nel periodo">
        <article class="panel rounded-3xl p-5"><p class="eyebrow">Appuntamenti</p><strong class="mt-2 block font-display text-3xl">{{ dashboard.activity.totalAppointments }}</strong></article>
        <article class="panel rounded-3xl p-5"><p class="eyebrow">Completati</p><strong class="mt-2 block font-display text-3xl">{{ dashboard.activity.completedAppointments }}</strong></article>
        <article class="panel rounded-3xl p-5"><p class="eyebrow">Servizi attribuiti</p><strong class="mt-2 block font-display text-3xl">{{ dashboard.activity.attributedServices }}</strong><p class="mt-1 text-xs opacity-65">Nei conti registrati nel periodo</p></article>
        <article class="panel rounded-3xl p-5"><p class="eyebrow">Assenze / annullati</p><strong class="mt-2 block font-display text-3xl">{{ dashboard.activity.noShows }} / {{ dashboard.activity.cancelledAppointments }}</strong></article>
      </section>
      <article *ngIf="dashboard.values as values" class="panel rounded-3xl p-5" data-tour="my-agenda-values"><p class="eyebrow">Valore registrato dei servizi</p><strong class="mt-2 block font-display text-3xl">{{ values.registeredServiceLineTotal | currency: values.currency }}</strong><p class="mt-2 text-sm opacity-75">Servizi completati in cui risulti come collaboratore, con conto confermato. Valori finali delle righe, comprese imposte registrate e sconti applicati. Il periodo segue la data del conto. Non indica incassi o compensi.</p></article>
      <section class="panel rounded-[2rem] p-5 sm:p-6" data-tour="my-agenda-schedule" aria-labelledby="personal-schedule-title">
        <h2 id="personal-schedule-title" class="font-display text-2xl">{{ collaboratorId ? "Orari del profilo" : "I miei orari" }}</h2>
        <p class="mt-2 text-sm opacity-75">Turni configurati dal salone, in {{ dashboard.timezone }}. Gli appuntamenti e le altre risorse determinano gli slot ancora prenotabili.</p>
        <div class="mt-4 grid gap-5 md:grid-cols-2">
          <div><h3 class="text-sm font-semibold">Settimana tipo</h3><p *ngIf="!dashboard.schedule.weekly.length" class="mt-2 text-sm opacity-70">Nessun turno settimanale configurato.</p>
            <p class="mt-2 text-xs opacity-65">I giorni senza un turno esplicito usano gli orari standard di prenotazione.</p>
            <dl class="mt-2 grid gap-2"><div *ngFor="let day of dashboard.schedule.weekly" class="flex flex-wrap justify-between gap-2 border-b border-current/10 pb-2 text-sm"><dt>{{ weekdayLabel(day.weekday) }}</dt><dd>{{ workingHours(day) }}</dd></div></dl>
          </div>
          <div><h3 class="text-sm font-semibold">Eccezioni nel periodo selezionato</h3><p *ngIf="!dashboard.schedule.overrides.length && !dashboard.schedule.closedDates.length" class="mt-2 text-sm opacity-70">Nessuna eccezione o chiusura configurata.</p>
            <dl class="mt-2 grid gap-2"><div *ngFor="let day of dashboard.schedule.overrides" class="flex flex-wrap justify-between gap-2 border-b border-current/10 pb-2 text-sm"><dt>{{ calendarDate(day.date) }}</dt><dd>{{ dashboard.schedule.closedDates.includes(day.date) ? 'Chiusura del salone' : day.isHoliday ? 'Ferie' : workingHours(day) }}</dd></div><div *ngFor="let date of dashboard.schedule.closedDates" [hidden]="hasOverride(date)" class="flex flex-wrap justify-between gap-2 border-b border-current/10 pb-2 text-sm"><dt>{{ calendarDate(date) }}</dt><dd>Chiusura del salone</dd></div></dl>
          </div>
        </div>
      </section>
      <section class="panel rounded-[2rem] p-5 sm:p-6" data-tour="my-agenda-appointments" aria-labelledby="personal-appointments-title">
        <div class="flex flex-wrap items-center justify-between gap-3"><h2 id="personal-appointments-title" class="font-display text-2xl">Appuntamenti assegnati</h2><span class="text-sm opacity-70">{{ dashboard.appointments.total }} nel periodo</span></div>
        <p *ngIf="!dashboard.appointments.items.length" class="py-8 text-sm opacity-75">Nessun appuntamento assegnato in questo periodo.</p>
        <article *ngFor="let item of dashboard.appointments.items" class="mt-4 rounded-3xl border border-current/10 p-4 sm:p-5">
          <div class="flex flex-wrap justify-between gap-3"><div><p class="text-sm text-[var(--accent)]">{{ dateTime(item.startsAt) }} – {{ time(item.endsAt) }}</p><h3 class="mt-1 font-display text-xl">{{ item.service.name }}</h3><p class="mt-1 text-sm">{{ item.customer.firstName }} {{ item.customer.lastName }}</p><p *ngIf="item.customer.phone" class="mt-1 text-sm opacity-70">{{ item.customer.phone }}</p></div><span class="status-pill status-pill-neutral self-start">{{ statusLabel(item.status) }}</span></div>
          <p *ngIf="item.location" class="text-xs opacity-70">{{ item.location.name }} · {{ item.sector?.name }}</p>
          <p *ngIf="item.customerNotes" class="mt-3 whitespace-pre-wrap text-sm opacity-75">{{ item.customerNotes }}</p>
          <p *ngIf="item.room" class="mt-2 text-xs opacity-65">{{ item.room.name }}</p>
          <div *ngIf="canUpdate" class="mt-3 flex flex-wrap gap-2" data-tour="my-agenda-status-actions"><button *ngFor="let next of transitions(item)" type="button" class="secondary-btn" [disabled]="!!updatingId || loading" (click)="pending = { id: item.id, status: next }">{{ actionLabel(next) }}</button></div>
          <div *ngIf="pending?.id === item.id" class="mt-4 border-t border-current/10 pt-3"><p class="text-sm">Confermare lo stato «{{ statusLabel(pending!.status) }}»?</p><div class="mt-2 flex gap-2"><button type="button" class="primary-btn" [disabled]="!!updatingId" (click)="commitStatus()">Conferma</button><button type="button" class="secondary-btn" [disabled]="!!updatingId" (click)="pending = null">Annulla</button></div></div>
        </article>
        <nav *ngIf="dashboard.appointments.total > dashboard.appointments.pageSize" class="mt-5 flex items-center justify-between gap-3" aria-label="Pagine degli appuntamenti"><button type="button" class="secondary-btn" [disabled]="page <= 1 || loading || !!updatingId" (click)="changePage(-1)">Precedenti</button><span class="text-sm">Pagina {{ page }}</span><button type="button" class="secondary-btn" [disabled]="!dashboard.appointments.hasMore || loading || !!updatingId" (click)="changePage(1)">Successivi</button></nav>
      </section>
    </ng-container>
  </ui-page>`,
})
export class PersonalAgendaComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly session = inject(SessionRefreshService);
  private readonly store = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  get collaboratorId(): string { return this.route.snapshot.queryParamMap.get("collaboratorId") || ""; }
  get storeUserIsTechnical(): boolean { return !!this.store.currentUser()?.technicalAccess; }
  data: PersonalDashboard | null = null;
  period: "day" | "week" | "month" = "week";
  readonly periodOptions: UiOption[] = [
    { value: "day", label: "Giorno" },
    { value: "week", label: "Settimana" },
    { value: "month", label: "Mese" },
  ];
  referenceDate = "";
  page = 1;
  loading = false;
  updatingId = "";
  pending: { id: string; status: string } | null = null;
  feedback = "";
  get companyRoute(): string { return this.store.can("users.manage") ? "/collaborators" : "/appointments"; }
  get canOpenInventory(): boolean { return this.store.can("inventory.read"); }
  get canOpenCompany(): boolean { return this.store.can("appointments.read.all") || this.store.can("users.manage"); }
  get canUpdate(): boolean { return this.store.can("appointments.update.all") || ((!this.collaboratorId || this.collaboratorId === this.store.currentUser()?.collaboratorId) && this.store.can("appointments.update.own")); }
  /** Booking in «La mia agenda»: only in one's own agenda. */
  get ownCollaboratorId(): string { return this.store.currentUser()?.collaboratorId || ""; }
  get canBook(): boolean {
    if (!this.ownCollaboratorId || (this.collaboratorId && this.collaboratorId !== this.ownCollaboratorId)) return false;
    return this.store.can("appointments.update.own") || this.store.can("appointments.create");
  }
  booking = false;
  onBooked(): void { this.booking = false; this.feedback = "Appuntamento prenotato."; void this.load(true); }
  ngOnInit(): void { void this.load(); }
  async load(preserveFeedback = false, resetPage = false): Promise<void> {
    if (resetPage) this.page = 1;
    this.loading = true;
    this.pending = null;
    if (!preserveFeedback) this.feedback = "";
    try {
      this.data = await firstValueFrom(this.api.loadPersonalDashboard(this.period, this.referenceDate, this.page, this.collaboratorId));
      this.referenceDate = this.data.referenceDate;
    } catch {
      this.data = null;
      this.feedback = "L’agenda non è disponibile. Verifica l’associazione e i permessi con il titolare, oppure aggiorna la pagina.";
    } finally { this.loading = false; }
  }
  today(): void { this.referenceDate = ""; void this.load(false, true); }
  changePage(delta: number): void { this.page += delta; void this.load(); }
  transitions(item: PersonalAppointment): readonly string[] { return PERSONAL_STATUS_TRANSITIONS[item.status] || []; }
  statusLabel(status: string): string { return ({ draft: "Bozza", requested: "Da confermare", confirmed: "Confermato", checked_in: "In corso", completed: "Completato", cancelled: "Annullato", no_show: "Assente", rescheduled: "Riprogrammato" } as Record<string, string>)[status] || status; }
  actionLabel(status: string): string { return ({ confirmed: "Conferma prenotazione", checked_in: "Segna arrivo", completed: "Completa servizio", no_show: "Segna assenza" } as Record<string, string>)[status] || this.statusLabel(status); }
  weekdayLabel(weekday: number): string { return ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"][weekday] || "Giorno non configurato"; }
  workingHours(day: { isWorkingDay: boolean; startTime: string | null; endTime: string | null }): string { return day.isWorkingDay && day.startTime && day.endTime ? `${day.startTime} – ${day.endTime}` : "Non lavorativo"; }
  calendarDate(value: string): string { return new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(value + "T00:00:00Z")); }
  hasOverride(date: string): boolean { return !!this.data?.schedule.overrides.some(day => day.date === date); }
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
