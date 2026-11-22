import { FinancialValuesPanelComponent } from "../shared/financial-values-panel.component";
import { FunctionAccessDirective } from "../shared/function-access.directive";
import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { AdminMetricsGridComponent } from "../shared/admin-metrics-grid.component";
import { CalendarInputComponent } from "../calendar-input.component";
import { UiSelectComponent } from "@alora/ui";
import { InfiniteScrollDirective } from "../shared/infinite-scroll.directive";
import { UiIconComponent } from "../shared/ui-icon.component";
import {
  activityStatusLabel,
  appointmentStatusLabel,
} from "../shared/presentation-copy";

const BALANCE_STORAGE_KEY = "barber.balance-hidden";

@Component({
  selector: "barber-admin-dashboard-page",
  standalone: true,
  imports: [
    FinancialValuesPanelComponent,
    FunctionAccessDirective,
    CommonModule,
    AdminMetricsGridComponent,
    CalendarInputComponent,
    UiSelectComponent,
    InfiniteScrollDirective,
    UiIconComponent,
  ],
  template: `
    <section class="grid gap-4">
      <article class="panel rounded-[2rem] p-4 sm:p-5">
        <div class="page-head">
          <div class="min-w-0">
            <p class="eyebrow text-[var(--accent)]">Andamento del salone</p>
            <h3 class="mt-1 font-display text-2xl sm:text-3xl">
              Venduto e incassi
            </h3>
          </div>
          <button
            type="button"
            class="ghost-btn balance-toggle"
            data-tour="dashboard-balance"
            (click)="toggleBalance()"
            [attr.aria-pressed]="balanceHidden"
            [attr.aria-label]="
              balanceHidden ? 'Mostra saldo' : 'Nascondi saldo'
            "
            [title]="balanceHidden ? 'Mostra saldo' : 'Nascondi saldo'"
          >
            <barber-ui-icon
              [name]="balanceHidden ? 'eye-off' : 'eye'"
              [animated]="!balanceHidden"
            ></barber-ui-icon>
            {{ balanceHidden ? "Mostra saldo" : "Nascondi saldo" }}
          </button>
        </div>
        <div
          class="mt-4 grid gap-2.5 sm:gap-3 md:grid-cols-2 xl:grid-cols-4"
          data-tour="dashboard-filters"
        >
          <div class="field">
            <span>Periodo</span>
            <ui-select
              [value]="revenueFilters.period"
              (valueChange)="applyPeriod($event)"
              [options]="periodOptions"
              label="Periodo"
            ></ui-select>
          </div>
          <label class="field" *ngIf="revenueFilters.period !== 'all'">
            <span>Data di riferimento</span>
            <barber-calendar-input
              [value]="revenueFilters.date"
              (valueChange)="applyDate($event)"
              label="Data"
              placeholder="Seleziona data"
            ></barber-calendar-input>
          </label>
          <div class="field">
            <span>Cliente</span>
            <ui-select
              [value]="revenueFilters.customerId"
              (valueChange)="applyCustomer($event)"
              [options]="customerFilterOptions"
              label="Cliente"
              placeholder="Tutti i clienti"
            ></ui-select>
          </div>
          <div class="field">
            <span>Professionista</span>
            <ui-select
              [value]="revenueFilters.collaboratorId"
              (valueChange)="applyCollaborator($event)"
              [options]="collaboratorFilterOptions"
              label="Professionista"
              placeholder="Tutta la squadra"
            ></ui-select>
          </div>
        </div>
        <div class="mt-3 flex justify-end">
          <button
            type="button"
            class="ghost-btn"
            data-tour="dashboard-reset"
            [disabled]="loading"
            (click)="resetRevenueFilters.emit()"
          >
            Azzera filtri
          </button>
        </div>
      </article>

      <p
        class="px-1 text-sm text-[var(--muted)]"
        *ngIf="revenueReport?.basis?.lineFiltered"
      >
        Il venduto comprende le righe selezionate. Incassi e residui sono
        registrati sul conto: per consultarli rimuovi i filtri attività e
        professionista.
      </p>
      <p
        class="px-1 text-sm text-[var(--muted)]"
        *ngIf="revenueReport && !revenueReport.basis?.lineFiltered"
      >
        Il venduto segue la data registrata del conto confermato. Incassi e
        rimborsi seguono la data del movimento, anche quando riguardano conti di
        un altro periodo. Sono inclusi solo conti interamente accessibili.
      </p>
      <p
        class="px-1 text-sm text-[var(--muted)]"
        *ngIf="
          revenueReport?.sold?.unattributedGross !== '0.00' &&
          revenueReport?.sold
        "
      >
        Differenza storica fra totale conti e righe:
        {{ money(revenueReport.sold.unattributedGross) }}. Questo importo non è
        attribuito a un’attività o a un esecutore.
      </p>

      <barber-admin-metrics-grid
        data-tour="dashboard-metrics"
        [metrics]="revenueMetrics"
        [masked]="balanceHidden"
      ></barber-admin-metrics-grid>

      <alora-financial-values-panel
        *ngIf="revenueReport"
        data-tour="dashboard-financial"
        [tax]="revenueReport.salesTax"
        [materials]="revenueReport.materials"
        [inventory]="revenueReport.inventory"
        [currency]="revenueReport.currency"
        [masked]="balanceHidden"
      ></alora-financial-values-panel>

      <div class="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <article
          class="panel rounded-[2rem] p-4 sm:p-5"
          data-tour="dashboard-activity"
        >
          <div class="min-w-0">
            <p class="eyebrow text-[var(--accent)]">Attività</p>
            <div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 class="font-display text-2xl">Conti del periodo</h3>
              <span class="status-pill status-pill-neutral">{{
                activity.length
              }}</span>
            </div>
          </div>
          <div class="mt-4 grid max-h-[26rem] gap-2 overflow-y-auto pr-1">
            <div *ngFor="let entry of activity" class="list-card items-center">
              <div class="min-w-0 flex-1">
                <div
                  class="activity-head flex min-w-0 flex-wrap items-center gap-2"
                >
                  <span
                    class="status-pill"
                    [ngClass]="
                      entry.kind === 'appointment'
                        ? 'status-pill-green'
                        : 'status-pill-blue'
                    "
                    >{{
                      entry.kind === "appointment"
                        ? "Appuntamento"
                        : entry.kind === "combined"
                          ? "Vendita e appuntamento"
                          : "Vendita"
                    }}</span
                  >
                  <strong class="min-w-0 truncate">{{
                    entry.customerName
                  }}</strong>
                </div>
                <p class="mt-1 text-sm text-[var(--muted)]">
                  {{ formatDateTime(entry.occurredAt) }} · {{ entry.detail }}
                </p>
                <p
                  *ngIf="entry.collaboratorName"
                  class="mt-1 text-xs text-[var(--muted)]"
                >
                  {{ entry.collaboratorName }}
                </p>
              </div>
              <div class="shrink-0 text-right">
                <strong>{{ money(entry.amount) }}</strong>
                <p class="text-xs text-[var(--muted)]">
                  {{
                    entry.amountBasis === "planned-account-value"
                      ? "Valore previsto"
                      : "Valore del conto"
                  }}
                </p>
                <p class="text-sm text-[var(--muted)]">
                  {{ formatActivityStatus(entry.status) }}
                </p>
              </div>
            </div>
            <p
              *ngIf="!activity.length && !activityLoading"
              class="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]"
            >
              Nessun conto nel periodo selezionato.
            </p>
            <p
              *ngIf="activityLoading"
              class="py-2 text-center text-xs uppercase tracking-wider text-[var(--muted)]"
            >
              Caricamento...
            </p>
            <div
              *ngIf="activityHasMore"
              class="h-px w-full"
              barberInfiniteScroll
              (loadMore)="loadMoreActivity.emit()"
            ></div>
          </div>
        </article>

        <div class="grid gap-4" data-tour="dashboard-breakdown">
          <article class="panel rounded-[2rem] p-4 sm:p-5">
            <p class="eyebrow text-[var(--accent)]">Clienti</p>
            <h3 class="font-display text-xl sm:text-2xl">
              Venduto per cliente
            </h3>
            <div class="mt-3 grid max-h-[18rem] gap-2 overflow-y-auto pr-1">
              <div
                *ngFor="let row of revenueReport?.byCustomer"
                class="list-card"
              >
                <strong>{{ row.label }}</strong
                ><span>{{ money(row.revenue) }}</span>
              </div>
              <p
                *ngIf="!revenueReport?.byCustomer?.length"
                class="text-sm text-[var(--muted)]"
              >
                Nessun conto confermato nel periodo selezionato.
              </p>
            </div>
          </article>
          <article class="panel rounded-[2rem] p-4 sm:p-5">
            <p class="eyebrow text-[var(--accent)]">Squadra</p>
            <h3 class="font-display text-xl sm:text-2xl">
              Servizi per esecutore dichiarato
            </h3>
            <div class="mt-3 grid max-h-[18rem] gap-2 overflow-y-auto pr-1">
              <div
                *ngFor="let row of revenueReport?.byCollaborator"
                class="list-card"
              >
                <strong>{{ row.label }}</strong
                ><span>{{ money(row.revenue) }}</span>
              </div>
              <p
                *ngIf="!revenueReport?.byCollaborator?.length"
                class="text-sm text-[var(--muted)]"
              >
                Nessuna riga di servizio nel periodo selezionato.
              </p>
            </div>
          </article>
        </div>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <article
          *ngFor="
            let group of [
              { title: 'Venduto per sede', rows: revenueReport?.byLocation },
              { title: 'Venduto per attività', rows: revenueReport?.bySector },
            ]
          "
          class="panel min-w-0 rounded-[2rem] p-4 sm:p-5"
        >
          <h3 class="font-display text-xl">{{ group.title }}</h3>
          <dl class="mt-3 grid gap-2">
            <div
              *ngFor="let row of group.rows"
              class="flex min-w-0 flex-wrap justify-between gap-2 border-b border-[var(--line)] py-2"
            >
              <dt class="min-w-0 break-words">{{ row.label }}</dt>
              <dd>{{ money(row.revenue) }}</dd>
            </div>
          </dl>
          <p
            *ngIf="!group.rows?.length"
            class="mt-3 text-sm text-[var(--muted)]"
          >
            Nessuna vendita nel periodo.
          </p>
        </article>
      </div>

      <div class="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <article
          class="panel rounded-[2rem] p-4 sm:p-5"
          data-tour="dashboard-upcoming"
        >
          <div class="min-w-0">
            <p class="eyebrow text-[var(--accent)]">Agenda</p>
            <div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 class="font-display text-2xl sm:text-3xl">
                Prossimi appuntamenti
              </h3>
              <span class="status-pill status-pill-green"
                >{{ appointmentStats?.total || 0 }} nel mese</span
              >
            </div>
          </div>
          <div
            class="mt-4 grid max-h-[24rem] gap-2.5 overflow-y-auto pr-1 sm:gap-3"
          >
            <button
              *ngFor="let appointment of upcomingAppointments"
              type="button"
              class="list-card text-left"
              (click)="editAppointment.emit(appointment)"
            >
              <div>
                <strong class="block text-lg"
                  >{{ formatTime(appointment.startsAt) }} ·
                  {{ appointment.customer.firstName }}
                  {{ appointment.customer.lastName }}</strong
                >
                <span class="text-sm text-[var(--muted)]"
                  >{{ appointment.service.name }} ·
                  {{
                    appointment.collaborator?.firstName || "Da assegnare"
                  }}</span
                >
              </div>
              <span
                class="status-pill"
                [ngClass]="appointmentStatusClass(appointment.status)"
                >{{ formatAppointmentStatus(appointment.status) }}</span
              >
            </button>
            <p
              *ngIf="!upcomingAppointments.length"
              class="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]"
            >
              Nessun appuntamento futuro confermato o richiesto.
            </p>
          </div>
        </article>

        <article
          class="dark-panel rounded-[2rem] p-4 text-white sm:p-5"
          data-testid="account-reconciliation"
          data-tour="dashboard-accounts"
        >
          <p class="eyebrow text-white/50">Situazione attuale</p>
          <h3 class="mt-1 font-display text-2xl">Conti del periodo</h3>
          <p class="mt-2 text-sm text-white/65">
            Conti aperti e confermati con data nel periodo, aggiornati ai
            movimenti registrati oggi.
          </p>
          <dl
            *ngIf="
              revenueReport?.accounts as balances;
              else noAccountAttribution
            "
            class="mt-4 grid gap-3"
          >
            <div class="flex flex-wrap justify-between gap-2">
              <dt>Totale conti riconciliati</dt>
              <dd>{{ money(balances.total) }}</dd>
            </div>
            <div class="flex flex-wrap justify-between gap-2">
              <dt>Saldi iniziali dichiarati</dt>
              <dd>{{ money(balances.opening) }}</dd>
            </div>
            <div class="flex flex-wrap justify-between gap-2">
              <dt>Ricevuto netto attuale</dt>
              <dd>{{ money(balances.netReceived) }}</dd>
            </div>
            <div
              class="flex flex-wrap justify-between gap-2 border-t border-white/20 pt-3 font-semibold"
            >
              <dt>Residuo attuale</dt>
              <dd>{{ money(balances.remaining) }}</dd>
            </div>
            <p class="text-sm text-white/65" *ngIf="balances.unknownCount">
              {{ balances.unknownCount }} conti storici, per
              {{ money(balances.unknownTotal) }}, hanno un incasso da
              riconciliare e sono esclusi dal residuo.
            </p>
          </dl>
          <ng-template #noAccountAttribution
            ><p class="mt-4 text-sm text-white/65">
              I pagamenti non sono ripartiti per riga. Consulta i conti completi
              rimuovendo i filtri attività e professionista.
            </p></ng-template
          >
        </article>
      </div>
    </section>
  `,
})
export class AdminDashboardPageComponent {
  @Input() revenueMetrics: any[] = [];
  @Input() appointmentStats: any = null;
  @Input() appointments: any[] = [];
  @Input() collaboratorStats: any[] = [];
  @Input() revenueReport: any = null;
  @Input() activity: any[] = [];
  @Input() activityHasMore = false;
  @Input() activityLoading = false;
  @Input() revenueFilters: any = {
    period: "day",
    date: "",
    customerId: "",
    collaboratorId: "",
  };
  @Input() customerOptions: Array<{ value: string; label: string }> = [];
  @Input() loading = false;
  @Output() editAppointment = new EventEmitter<any>();
  @Output() applyRevenueFilters = new EventEmitter<void>();
  @Output() resetRevenueFilters = new EventEmitter<void>();
  @Output() loadMoreActivity = new EventEmitter<void>();
  @Output() openQuickOrder = new EventEmitter<void>();

  balanceHidden = readStoredBalanceHidden();

  toggleBalance(): void {
    this.balanceHidden = !this.balanceHidden;
    try {
      window.localStorage.setItem(
        BALANCE_STORAGE_KEY,
        this.balanceHidden ? "1" : "0",
      );
    } catch {
      // Storage can be unavailable (private mode); the toggle still works.
    }
  }

  money(value: number | string | null | undefined): string {
    if (this.balanceHidden) {
      return "**,**";
    }

    if (typeof value === "string" && /^-?\d+\.\d{2}$/.test(value))
      return `€${value}`;
    const amount = Number(value ?? 0);
    return `€${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
  }

  get customerFilterOptions(): Array<{ value: string; label: string }> {
    return [{ value: "", label: "Tutti i clienti" }, ...this.customerOptions];
  }

  applyPeriod(period: string): void {
    this.revenueFilters.period = period;
    this.applyRevenueFilters.emit();
  }

  applyCustomer(customerId: string): void {
    this.revenueFilters.customerId = customerId;
    this.applyRevenueFilters.emit();
  }

  applyCollaborator(collaboratorId: string): void {
    this.revenueFilters.collaboratorId = collaboratorId;
    this.applyRevenueFilters.emit();
  }

  applyDate(date: string): void {
    this.revenueFilters.date = date;
    this.applyRevenueFilters.emit();
  }

  get collaboratorFilterOptions(): Array<{ value: string; label: string }> {
    return [
      { value: "", label: "Tutta la squadra" },
      ...(this.revenueReport?.collaboratorOptions || []),
    ];
  }

  readonly periodOptions = [
    { value: "day", label: "Giorno" },
    { value: "week", label: "Settimana" },
    { value: "month", label: "Mese" },
    { value: "year", label: "Anno" },
    { value: "all", label: "Tutto" },
  ];

  get upcomingAppointments(): any[] {
    const now = Date.now();
    return this.appointments
      .filter(
        (appointment) =>
          new Date(appointment.startsAt).getTime() >= now &&
          ["requested", "confirmed", "checked_in", "rescheduled"].includes(
            appointment.status,
          ),
      )
      .sort(
        (left, right) =>
          new Date(left.startsAt).getTime() -
          new Date(right.startsAt).getTime(),
      )
      .slice(0, 50);
  }

  formatTime(value: string): string {
    return new Date(value).toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  formatDateTime(value: string): string {
    return new Date(value).toLocaleString("it-IT", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  formatActivityStatus(status: string): string {
    return activityStatusLabel(status);
  }

  formatAppointmentStatus(status: string): string {
    return appointmentStatusLabel(status);
  }

  appointmentStatusClass(status: string): string {
    switch (status) {
      case "requested":
      case "rescheduled":
        return "status-pill-amber";
      case "confirmed":
      case "checked_in":
        return "status-pill-blue";
      case "completed":
        return "status-pill-green";
      case "cancelled":
      case "no_show":
        return "status-pill-red";
      default:
        return "status-pill-neutral";
    }
  }
}

function readStoredBalanceHidden(): boolean {
  try {
    return window.localStorage.getItem(BALANCE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
