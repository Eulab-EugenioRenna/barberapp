import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";

export type UiIconName = "plus" | "edit" | "trash" | "save" | "receipt";

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
      </ng-container>
    </svg>
  `,
})
export class UiIconComponent {
  @Input({ required: true }) name!: UiIconName;
}
