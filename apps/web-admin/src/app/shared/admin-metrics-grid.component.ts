import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";

@Component({
  selector: "barber-admin-metrics-grid",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-5">
      <article
        *ngFor="let metric of metrics"
        class="metric-card panel rounded-[1.2rem] p-3 sm:rounded-[1.7rem] sm:p-4"
      >
        <p class="text-xs font-semibold text-[var(--muted)] sm:text-sm">
          {{ metric.label }}
        </p>
        <strong class="mt-2 block font-display text-2xl sm:text-4xl">{{
          displayValue(metric)
        }}</strong>
        <span class="status-pill status-pill-neutral mt-2">{{ metric.trend }}</span>
      </article>
    </div>
  `,
})
export class AdminMetricsGridComponent {
  @Input() metrics: Array<{ label: string; value: string; trend: string }> = [];
  @Input() masked = false;

  displayValue(metric: { value: string }): string {
    if (this.masked && /EUR|€/.test(metric.value)) {
      return "**,**";
    }

    return metric.value;
  }
}
