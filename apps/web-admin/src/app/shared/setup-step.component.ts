import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";
import { RouterLink } from "@angular/router";

export type SetupStepState = "locked" | "todo" | "done";

/**
 * One step of a guided configuration. ALORA rule: a setting that depends on
 * another is not shown until that one is done. A locked step shows only why
 * and where to go; its content is not rendered.
 *
 * <alora-setup-step [index]="1" title="…" [state]="…" lockedReason="…" lockedLink="/whatsapp">
 *   …fields…
 * </alora-setup-step>
 */
@Component({
  selector: "alora-setup-step",
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="step" [class.locked]="state === 'locked'" [class.done]="state === 'done'" [attr.aria-label]="title">
      <header>
        <span class="badge" aria-hidden="true">{{ state === "done" ? "✓" : index }}</span>
        <div class="heading">
          <h3>{{ title }}</h3>
          <p *ngIf="summary && state !== 'locked'" class="summary">{{ summary }}</p>
        </div>
        <span class="state">{{ state === "done" ? "Fatto" : state === "locked" ? "Bloccato" : "Da fare" }}</span>
      </header>
      <div *ngIf="state === 'locked'; else body" class="locked-note">
        <p>Per attivarlo serve prima: {{ lockedReason }}</p>
        <a *ngIf="lockedLink" class="secondary-btn" [routerLink]="lockedLink" [queryParams]="lockedQuery">{{ lockedLinkLabel || "Vai" }}</a>
      </div>
      <ng-template #body><div class="content"><ng-content></ng-content></div></ng-template>
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .step {
        border: 1px solid var(--line, #d9dfd8);
        border-radius: 20px;
        background: var(--panel, #fffdf8);
        padding: clamp(16px, 2.5vw, 26px);
      }
      .step.locked { background: #f6f6f2; }
      .step.locked h3, .step.locked .badge { opacity: 0.6; }
      header { display: flex; align-items: flex-start; gap: 14px; }
      .badge {
        flex: none; display: grid; place-items: center;
        width: 2rem; height: 2rem; border-radius: 999px;
        border: 1px solid var(--line, #ccd6ce); font-weight: 700; font-size: 0.9rem;
      }
      .done .badge { background: var(--accent, #1e3425); border-color: transparent; color: #fff; }
      .heading { flex: 1; min-width: 0; }
      h3 { margin: 0.2rem 0 0; font-size: 1.05rem; }
      .summary { margin: 0.25rem 0 0; font-size: 0.85rem; color: var(--muted, #68746d); }
      .state { flex: none; font-size: 0.75rem; color: var(--muted, #68746d); margin-top: 0.4rem; }
      .done .state { color: var(--accent, #1e3425); font-weight: 600; }
      .locked-note {
        display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px;
        margin: 14px 0 0 calc(2rem + 14px); font-size: 0.88rem; color: #5a4925;
      }
      .locked-note p { margin: 0; }
      .content { margin: 16px 0 0 calc(2rem + 14px); min-width: 0; }
      @media (max-width: 47.99rem) {
        .content, .locked-note { margin-left: 0; }
      }
    `,
  ],
})
export class SetupStepComponent {
  @Input() index = 1;
  @Input() title = "";
  @Input() state: SetupStepState = "todo";
  /** One line, in plain words, shown when locked. */
  @Input() summary = "";
  @Input() lockedReason = "";
  @Input() lockedLink: string | null = null;
  @Input() lockedQuery: Record<string, string> | null = null;
  @Input() lockedLinkLabel = "";
}
