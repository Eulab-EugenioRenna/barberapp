import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";

@Component({
  selector: "barber-admin-metrics-grid",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="grid gap-4 xl:grid-cols-4">
      <article
        *ngFor="let metric of metrics"
        class="metric-card panel rounded-[1.7rem] p-5"
      >
        <p class="text-sm font-semibold text-[var(--muted)]">
          {{ metric.label }}
        </p>
        <strong class="mt-3 block font-display text-4xl">{{
          metric.value
        }}</strong>
        <span class="status-pill status-pill-neutral mt-3">{{
          metric.trend
        }}</span>
      </article>
    </div>
  `,
})
export class AdminMetricsGridComponent {
  @Input() metrics: Array<{ label: string; value: string; trend: string }> = [];
}
