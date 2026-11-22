import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from "@angular/core";
import { UiIconComponent } from "../icon/ui-icon.component";
import type { UiNavItem } from "./ui-nav.types";

/**
 * Thumb-reach bar for mobile: up to four primary destinations plus a "more"
 * entry that opens the full navigation. Visibility per breakpoint is decided
 * by the shell, not here.
 */
@Component({
  selector: "ui-bottom-nav",
  standalone: true,
  imports: [CommonModule, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<nav [attr.aria-label]="ariaLabel">
    <button
      *ngFor="let item of items; trackBy: trackItem"
      type="button"
      class="ui-bn-item"
      [attr.data-tour]="'nav-' + item.key"
      [class.ui-active]="item.key === activeKey"
      [attr.aria-current]="item.key === activeKey ? 'page' : null"
      [attr.aria-label]="item.badge ? item.label + ', ' + item.badge + ' da gestire' : item.label"
      (click)="select.emit(item.key)"
    >
      <span class="ui-bn-icon">
        <ui-icon [name]="item.icon"></ui-icon>
        <span *ngIf="item.badge" class="ui-bn-badge" aria-hidden="true">{{
          item.badge > 99 ? "99+" : item.badge
        }}</span>
      </span>
      <span class="ui-bn-label">{{ item.short || item.label }}</span>
    </button>
    <button
      type="button"
      class="ui-bn-item"
      data-tour="nav-more"
      [class.ui-active]="moreActive"
      [attr.aria-label]="moreAriaLabel"
      (click)="more.emit()"
    >
      <span class="ui-bn-icon"><ui-icon name="menu"></ui-icon></span>
      <span class="ui-bn-label">{{ moreLabel }}</span>
    </button>
  </nav>`,
  styles: [
    `
      :host {
        display: block;
        --ui-icon-size: 1.15rem;
      }
      nav {
        display: flex;
        align-items: stretch;
        justify-content: space-around;
        gap: 0.25rem;
        padding: 0.4rem 0.5rem calc(0.4rem + env(safe-area-inset-bottom, 0px));
        border-top: 0.0625rem solid rgba(30, 52, 37, 0.08);
        background: rgba(255, 255, 255, 0.92);
        box-shadow: 0 -0.75rem 2.5rem rgba(30, 52, 37, 0.12);
      }
      .ui-bn-item {
        display: flex;
        flex: 1 1 0;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.2rem;
        min-width: 0;
        min-height: 3.25rem;
        border: 0;
        border-radius: 1rem;
        background: transparent;
        padding: 0.35rem 0.25rem;
        color: var(--muted);
        font: inherit;
        font-size: 0.68rem;
        font-weight: 700;
        line-height: 1.1;
        cursor: pointer;
        transition: 160ms ease;
      }
      .ui-bn-item:active {
        background: rgba(30, 52, 37, 0.05);
      }
      .ui-bn-item:focus-visible {
        outline: 0.1875rem solid var(--focus);
        outline-offset: 0.125rem;
      }
      .ui-bn-item.ui-active {
        color: var(--brand);
        background: rgba(30, 52, 37, 0.1);
      }
      .ui-bn-icon {
        position: relative;
        display: inline-grid;
        place-items: center;
        width: 1.9rem;
        height: 1.9rem;
        border-radius: 0.75rem;
        background: rgba(30, 52, 37, 0.06);
      }
      .ui-bn-item.ui-active .ui-bn-icon {
        background: rgba(30, 52, 37, 0.16);
      }
      .ui-bn-badge {
        position: absolute;
        top: -0.4rem;
        right: -0.5rem;
        display: inline-grid;
        place-items: center;
        min-width: 1.15rem;
        height: 1.15rem;
        padding: 0 0.28rem;
        border-radius: 999rem;
        background: #dc2626;
        color: #fff;
        font-size: 0.62rem;
        font-weight: 800;
        line-height: 1;
      }
      .ui-bn-label {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ],
})
export class UiBottomNavComponent {
  @Input() items: UiNavItem[] = [];
  @Input() activeKey: string | null = null;
  /** True when the current page is not one of `items`. */
  @Input() moreActive = false;
  @Input() moreLabel = "Altro";
  @Input() moreAriaLabel = "Apri tutte le sezioni";
  @Input() ariaLabel = "Sezioni principali";
  @Output() readonly select = new EventEmitter<string>();
  @Output() readonly more = new EventEmitter<void>();

  trackItem = (_: number, item: UiNavItem) => item.key;
}
