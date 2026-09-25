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
  | "ban"
  | "eye"
  | "eye-off"
  | "refresh"
  | "calendar-plus";

@Component({
  selector: "barber-ui-icon",
  standalone: true,
  imports: [CommonModule],
  host: {
    "aria-hidden": "true",
    "[class.ui-icon-animated]": "animated",
  },
  styles: [
    `
      :host {
        display: inline-flex;
        line-height: 0;
      }

      :host(.ui-icon-animated) svg {
        transform-origin: center;
        animation: ui-eye-blink 3.6s ease-in-out infinite;
      }

      :host(.ui-icon-animated:hover) svg {
        animation: none;
        transform: scale(1.15);
      }

      @keyframes ui-eye-blink {
        0%,
        88%,
        100% {
          transform: scaleY(1);
        }
        92% {
          transform: scaleY(0.12);
        }
        96% {
          transform: scaleY(1);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        :host(.ui-icon-animated) svg {
          animation: none;
        }
      }
    `,
  ],
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
        <path
          *ngSwitchCase="'eye'"
          d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        />
        <circle *ngSwitchCase="'eye'" cx="12" cy="12" r="3" />
        <path
          *ngSwitchCase="'eye-off'"
          d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.7A10 10 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.5 16.5 0 0 1-3.1 3.9M6.4 6.4A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5c1.1 0 2.2-.2 3.2-.6"
        />
        <path *ngSwitchCase="'refresh'" d="M20.5 12a8.5 8.5 0 1 1-2.7-6.1" />
        <path *ngSwitchCase="'refresh'" d="M21 3.5V10h-6.5" />
        <path
          *ngSwitchCase="'calendar-plus'"
          d="M7.5 3.5V7M16.5 3.5V7M3.5 9.5H20.5M5.5 5h13A2 2 0 0 1 20.5 7v12a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM12 12v5M9.5 14.5h5"
        />
      </ng-container>
    </svg>
  `,
})
export class UiIconComponent {
  @Input({ required: true }) name!: UiIconName;
  @Input() animated = false;
}
