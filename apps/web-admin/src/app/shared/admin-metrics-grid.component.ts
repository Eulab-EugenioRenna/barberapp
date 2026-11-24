import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";

@Component({
  selector: "barber-admin-metrics-grid",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="grid grid-cols-2 gap-2.5 sm:gap-3"
      [ngClass]="{
        'xl:grid-cols-5': metrics.length >= 5,
        'xl:grid-cols-4': metrics.length === 4,
        'xl:grid-cols-3': metrics.length === 3
      }"
    >
      <article
        *ngFor="let metric of metrics"
        class="metric-card min-w-0 panel rounded-[1.2rem] p-3 sm:rounded-[1.7rem] sm:p-4"
      >
        <p class="text-xs font-semibold text-[var(--muted)] sm:text-sm">
          {{ metric.label }}
        </p>
        <strong
          class="mt-2 block break-words font-display text-xl sm:text-3xl"
          >{{ displayValue(metric) }}</strong
        >
        <span class="mt-2 block text-xs text-[var(--muted)]">{{
          displayTrend(metric)
        }}</span>
      </article>
    </div>
  `,
})
export class AdminMetricsGridComponent {
  @Input() metrics: Array<{ label: string; value: string; trend: string }> = [];
  @Input() masked = false;

  displayValue(metric: { value: string }): string {
    if (this.masked && /^[A-Z]{3}\s|€/.test(metric.value)) {
      return "**,**";
    }

    return metric.value;
  }

  /** Amounts inside the explanation line are hidden too. */
  displayTrend(metric: { trend: string }): string {
    return this.masked
      ? metric.trend.replace(/(?:[A-Z]{3}\s|€)-?[\d.,]+/g, "**,**")
      : metric.trend;
  }
}
