import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";

export type UiIconName =
  | "plus"
  | "edit"
  | "trash"
  | "save"
  | "receipt"
  | "link"
  | "clock"
  | "ban";

@Component({
  selector: "barber-ui-icon",
  standalone: true,
  imports: [CommonModule],
  host: { "aria-hidden": "true" },
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-[1.05rem] w-[1.05rem] shrink-0"
    >
      <ng-container [ngSwitch]="name">
        <path *ngSwitchCase="'plus'" d="M12 5v14M5 12h14" />
        <path *ngSwitchCase="'edit'" d="m4 20 4.2-1 10.6-10.6a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z" />
        <path *ngSwitchCase="'trash'" d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
        <path *ngSwitchCase="'save'" d="M5 4h12l2 2v14H5V4Zm3 0v6h8V4M8 20v-6h8v6" />
        <path *ngSwitchCase="'receipt'" d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6" />
        <path
          *ngSwitchCase="'link'"
          d="M10 13a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66L11 6.34m2 4.66a4 4 0 0 0-5.66 0L4.5 13.83a4 4 0 0 0 5.66 5.66L12 17.66"
        />
        <path *ngSwitchCase="'clock'" d="M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        <path
          *ngSwitchCase="'ban'"
          d="M4.9 4.9l14.2 14.2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        />
      </ng-container>
    </svg>
  `,
})
export class UiIconComponent {
  @Input({ required: true }) name!: UiIconName;
}
