import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, Input } from "@angular/core";

/**
 * Icon set: 24x24 grid, 1.8 stroke, rounded caps. Each icon is a list of
 * path commands so a new icon is a data change, not a template change.
 */
const ICONS = {
  plus: ["M12 5v14M5 12h14"],
  help: [
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    "M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6M12 17h.01",
  ],
  edit: ["m4 20 4.2-1 10.6-10.6a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z"],
  trash: ["M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"],
  save: ["M5 4h12l2 2v14H5V4Zm3 0v6h8V4M8 20v-6h8v6"],
  receipt: ["M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6"],
  link: [
    "M10 13a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66L11 6.34m2 4.66a4 4 0 0 0-5.66 0L4.5 13.83a4 4 0 0 0 5.66 5.66L12 17.66",
  ],
  clock: ["M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"],
  ban: ["M4.9 4.9l14.2 14.2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"],
  eye: [
    "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z",
    "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  ],
  "eye-off": [
    "M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.7A10 10 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.5 16.5 0 0 1-3.1 3.9M6.4 6.4A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5c1.1 0 2.2-.2 3.2-.6",
  ],
  refresh: ["M20.5 12a8.5 8.5 0 1 1-2.7-6.1", "M21 3.5V10h-6.5"],
  "calendar-plus": [
    "M7.5 3.5V7M16.5 3.5V7M3.5 9.5H20.5M5.5 5h13A2 2 0 0 1 20.5 7v12a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM12 12v5M9.5 14.5h5",
  ],
  // Navigation
  overview: ["M4 13h6V4H4v9Zm10 7h6V11h-6v9ZM4 20h6v-4H4v4ZM14 4v4h6V4h-6Z"],
  calendar: [
    "M7.5 3.5V7M16.5 3.5V7M3.5 9.5H20.5M5.5 5h13A2 2 0 0 1 20.5 7v12a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
  ],
  "check-circle": ["M8.5 12.5l2.5 2.5 4.5-5", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"],
  cash: [
    "M3 7h18v10H3V7Z",
    "M14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM6 10v4m12-4v4",
  ],
  users: [
    "M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20",
    "M13.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0ZM20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.6a3.5 3.5 0 0 1 0 6.8",
  ],
  chat: ["M20 12a8 8 0 0 1-11.8 7L4 20l1.1-4A8 8 0 1 1 20 12Z"],
  scissors: [
    "M9 7a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM9 17a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z",
    "M8.6 8.4 20 18M8.6 15.6 20 6",
  ],
  box: ["M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z", "M3.5 7.5 12 12l8.5-4.5M12 12v9"],
  "map-pin": [
    "M12 21s-7-6.1-7-11.5a7 7 0 1 1 14 0C19 14.9 12 21 12 21Z",
    "M14.5 9.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z",
  ],
  team: [
    "M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM5 20v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1",
  ],
  bell: ["M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z", "M10 20.5a2 2 0 0 0 4 0"],
  store: [
    "M4 10v10h16V10M3 6l1.5-3h15L21 6v1.5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0V6Z",
    "M10 20v-5h4v5",
  ],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1"],
  agenda: [
    "M5.5 5h13A2 2 0 0 1 20.5 7v12a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM7.5 3.5V7M16.5 3.5V7M3.5 9.5h17",
    "M8 13.5h3M8 17h6",
  ],
  logout: ["M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3", "M10 16l-4-4 4-4M6 12h10"],
  menu: ["M4 7h16M4 12h16M4 17h16"],
  close: ["M6 6l12 12M18 6 6 18"],
  "chevron-left": ["M14.5 6 8.5 12l6 6"],
  "chevron-right": ["M9.5 6l6 6-6 6"],
  "chevron-down": ["M6 9.5l6 6 6-6"],
  building: ["M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M3 21h18", "M9 7h2m2 0h2M9 11h2m2 0h2M9 15h2m2 0h2"],
} as const satisfies Record<string, readonly string[]>;

export type UiIconName = keyof typeof ICONS;

@Component({
  // `barber-ui-icon` keeps existing templates working while they migrate.
  selector: "ui-icon, barber-ui-icon",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
      svg {
        width: var(--ui-icon-size, 1.05rem);
        height: var(--ui-icon-size, 1.05rem);
        flex-shrink: 0;
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
  template: `<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path *ngFor="let d of paths" [attr.d]="d" />
  </svg>`,
})
export class UiIconComponent {
  @Input({ required: true }) name!: UiIconName;
  @Input() animated = false;

  get paths(): readonly string[] {
    return ICONS[this.name] ?? [];
  }
}
