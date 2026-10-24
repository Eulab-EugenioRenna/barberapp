import { AloraBrandComponent } from "@barber/shared/brand";
import { CommonModule } from "@angular/common";
import { Component, inject, OnInit } from "@angular/core";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { AdminApiService } from "../core/admin-api.service";
import { SessionRefreshService } from "../core/session-refresh.service";
@Component({
  standalone: true,
  imports: [CommonModule, AloraBrandComponent],
  template: `<main class="mx-auto max-w-4xl p-6">
    <div class="mb-6"><alora-brand></alora-brand></div>
    <div class="flex items-center justify-between">
      <h1 class="font-display text-3xl">La mia agenda</h1>
      <button class="secondary-btn" (click)="logout()">Esci</button>
    </div>
    <p class="my-4" *ngIf="feedback">{{ feedback }}</p>
    <button class="secondary-btn my-4" (click)="load()">Aggiorna</button>
    <article
      class="panel rounded-2xl p-4 mb-4"
      *ngFor="let item of appointments"
    >
      <p>
        {{ item.startsAt | date: "dd/MM/yyyy HH:mm" }} –
        {{ item.endsAt | date: "HH:mm" }}
      </p>
      <h2 class="text-xl">{{ item.service?.name }}</h2>
      <p>{{ item.customer?.firstName }} {{ item.customer?.lastName }}</p>
      <p>{{ item.customer?.phone }}</p>
      <p>{{ item.customerNotes }}</p>
      <p>{{ item.status }}</p>
    </article>
    <p *ngIf="!appointments.length && !feedback">
      Nessun appuntamento assegnato.
    </p>
  </main>`,
})
export class PersonalAgendaComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly session = inject(SessionRefreshService);
  private readonly router = inject(Router);
  appointments: any[] = [];
  feedback = "";
  ngOnInit(): void {
    void this.load();
  }
  async load(): Promise<void> {
    try {
      this.appointments = await firstValueFrom(this.api.loadAppointments());
      this.feedback = "";
    } catch {
      this.feedback =
        "Accesso all’agenda non disponibile. Accedi nuovamente o contatta il titolare.";
    }
  }
  logout(): void {
    this.session.logout();
    void this.router.navigateByUrl("/login");
  }
}
