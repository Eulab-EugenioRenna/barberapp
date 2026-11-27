import { CommonModule } from "@angular/common";
import { Component, OnInit, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { ADMIN_API_URL } from "../core/api-config";
import { canAccessLocalView } from "@barber/shared/functions";
import { SessionStore } from "../core/session.store";
import { visibleSetup, type SetupKey as Key, type SetupStatus as Status } from "./setup-checklist.logic";


/** What each step is, where it is done and what it unlocks, in plain words. */
const COPY: Record<Key, { title: string; why: string; link: string; action: string }> = {
  location: { title: "Crea la sede e i suoi orari", why: "Gli orari di apertura decidono quando si può prenotare.", link: "/locations", action: "Vai a Sedi" },
  services: { title: "Aggiungi i servizi", why: "Durata e prezzo servono all’agenda e alla cassa.", link: "/services", action: "Vai al Listino" },
  team: { title: "Aggiungi i collaboratori e i loro orari", why: "Senza orari dei collaboratori non ci sono posti liberi in agenda.", link: "/collaborators", action: "Vai a Squadra" },
  customers: { title: "Aggiungi i clienti", why: "Puoi anche crearli al momento della prenotazione.", link: "/customers", action: "Vai a Clienti" },
  whatsapp: { title: "Collega il numero WhatsApp", why: "Per scrivere ai clienti e inviare i promemoria.", link: "/whatsapp", action: "Collega" },
  reminders: { title: "Attiva i promemoria degli appuntamenti", why: "ALORA ricorda l’appuntamento e chiede conferma al cliente.", link: "/notifications", action: "Configura" },
  online: { title: "Apri le prenotazioni online", why: "I clienti prenotano da soli dalla tua pagina.", link: "/settings", action: "Vai a Profilo" },
};
const HIDDEN_KEY = "alora.setup-checklist.hidden";
const CACHE_MS = 60_000;
let cached: { at: number; status: Status } | null = null;

/**
 * «Primi passi» on Panoramica: the real setup order. A step that depends on
 * another says which one to do first instead of sending the user to a screen
 * they cannot complete yet.
 */
@Component({
  selector: "alora-setup-checklist",
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <article *ngIf="status && !hidden && status.completed < status.total" class="panel rounded-[2rem] p-4 sm:p-5" data-tour="dashboard-setup" aria-labelledby="setup-title">
      <div class="head">
        <div>
          <p class="eyebrow text-[var(--accent)]">Primi passi</p>
          <h3 id="setup-title" class="font-display text-2xl">Prepara ALORA in ordine</h3>
          <p class="muted">{{ status.completed }} di {{ status.total }} fatti. Ogni passo si apre quando hai completato quello che serve prima.</p>
        </div>
        <button type="button" class="ghost-btn" (click)="hide()">Nascondi</button>
      </div>
      <div class="bar" role="progressbar" [attr.aria-valuenow]="status.completed" aria-valuemin="0" [attr.aria-valuemax]="status.total">
        <span [style.width.%]="(status.completed / status.total) * 100"></span>
      </div>
      <ol>
        <li *ngFor="let step of status.steps; let i = index" [class.done]="step.done" [class.locked]="!step.done && step.blockedBy">
          <span class="num" aria-hidden="true">{{ step.done ? "✓" : i + 1 }}</span>
          <div class="body">
            <strong>{{ copy[step.key].title }}<span *ngIf="step.optional" class="opt"> · facoltativo</span></strong>
            <small *ngIf="step.done">{{ step.detail || "Fatto" }}</small>
            <small *ngIf="!step.done && step.blockedBy">Prima: {{ copy[step.blockedBy].title.toLowerCase() }}.</small>
            <small *ngIf="!step.done && !step.blockedBy">{{ copy[step.key].why }}</small>
          </div>
          <a *ngIf="!step.done && !step.blockedBy" class="secondary-btn" [routerLink]="copy[step.key].link">{{ copy[step.key].action }}</a>
        </li>
      </ol>
    </article>
  `,
  styles: [
    `
      .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
      .muted { margin: 0.35rem 0 0; font-size: 0.85rem; color: var(--muted); }
      .bar { height: 6px; border-radius: 999px; background: var(--surface); margin: 14px 0; overflow: hidden; }
      .bar span { display: block; height: 100%; background: var(--accent); border-radius: inherit; }
      ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
      li { display: flex; align-items: center; gap: 12px; border: 1px solid var(--line); border-radius: 1rem; padding: 10px 12px; }
      li.done { opacity: 0.7; }
      li.locked { background: var(--surface); }
      li.locked strong { opacity: 0.65; }
      .num { flex: none; display: grid; place-items: center; width: 1.9rem; height: 1.9rem; border-radius: 999px; border: 1px solid var(--line); font-size: 0.85rem; font-weight: 700; }
      li.done .num { background: var(--accent); color: #fff; border-color: transparent; }
      .body { flex: 1; min-width: 0; display: grid; gap: 2px; }
      .body strong { font-size: 0.92rem; }
      .opt { font-weight: 400; color: var(--muted); }
      small { font-size: 0.8rem; color: var(--muted); }
    `,
  ],
})
export class SetupChecklistComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionStore);
  readonly copy = COPY;
  status: Status | null = cached && Date.now() - cached.at < CACHE_MS ? this.visible(cached.status) : null;
  hidden = localStorage.getItem(HIDDEN_KEY) === "1";

  async ngOnInit() {
    // Coming back to the Panoramica within a minute reuses the last answer.
    if (this.hidden || (cached && Date.now() - cached.at < CACHE_MS)) return;
    try {
      const status = await firstValueFrom(this.http.get<Status>(`${ADMIN_API_URL}/tenant/setup-status`));
      cached = { at: Date.now(), status };
      this.status = this.visible(status);
    } catch { this.status = null; }
  }
  private visible(status: Status): Status | null {
    const user = this.session.currentUser();
    return visibleSetup(status, (view) => canAccessLocalView(user, view));
  }
  hide() { this.hidden = true; localStorage.setItem(HIDDEN_KEY, "1"); }
}
