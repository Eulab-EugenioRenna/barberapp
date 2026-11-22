import { CommonModule } from "@angular/common";
import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  inject,
} from "@angular/core";
import { UiIconComponent } from "../icon/ui-icon.component";
import type { UiNavGroup, UiNavItem } from "./ui-nav.types";

/**
 * Grouped vertical navigation for a dark surface. Expanded: group labels,
 * icon, label and hint. Collapsed (rail): icons only, groups separated by a
 * divider, label exposed through aria-label and title.
 */
@Component({
  selector: "ui-side-nav",
  standalone: true,
  imports: [CommonModule, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { "[class.collapsed]": "collapsed" },
  template: `<nav [attr.aria-label]="ariaLabel">
    <section *ngFor="let group of groups; trackBy: trackGroup" class="ui-nav-group">
      <h3 class="ui-nav-group-label" [attr.id]="'ui-nav-' + group.id">{{ group.label }}</h3>
      <ul [attr.aria-labelledby]="'ui-nav-' + group.id">
        <li *ngFor="let item of group.items; trackBy: trackItem">
          <button
            type="button"
            class="ui-nav-item"
            [attr.data-tour]="'nav-' + item.key"
            [class.ui-active]="item.key === activeKey"
            [attr.aria-current]="item.key === activeKey ? 'page' : null"
            [attr.aria-label]="collapsed ? itemAriaLabel(item) : null"
            [attr.title]="collapsed ? item.label : null"
            (click)="select.emit(item.key)"
          >
            <span class="ui-nav-icon">
              <ui-icon [name]="item.icon"></ui-icon>
              <span *ngIf="item.badge" class="ui-nav-badge" aria-hidden="true">{{
                item.badge > 99 ? "99+" : item.badge
              }}</span>
            </span>
            <span class="ui-nav-copy">
              <span class="ui-nav-label">{{ item.label }}</span>
              <small *ngIf="item.hint" class="ui-nav-hint">{{ item.hint }}</small>
            </span>
            <span *ngIf="item.badge" class="ui-sr-only">, {{ item.badge }} da gestire</span>
          </button>
        </li>
      </ul>
    </section>
  </nav>`,
  styles: [
    `
      :host {
        display: block;
        min-height: 0;
        --ui-icon-size: 1.15rem;
      }
      nav {
        display: grid;
        gap: 1.1rem;
      }
      .ui-nav-group {
        display: grid;
        gap: 0.35rem;
      }
      .ui-nav-group-label {
        margin: 0;
        padding-inline: 1rem;
        color: rgba(255, 255, 255, 0.5);
        font-size: 0.66rem;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      ul {
        display: grid;
        gap: 0.35rem;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .ui-nav-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        width: 100%;
        min-height: 2.9rem;
        border: 0.0625rem solid rgba(255, 255, 255, 0.08);
        border-radius: 1.2rem;
        background: rgba(255, 255, 255, 0.03);
        padding: 0.6rem 0.9rem;
        color: rgba(255, 255, 255, 0.85);
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition: 180ms ease;
      }
      .ui-nav-item:hover {
        border-color: rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
      }
      .ui-nav-item:focus-visible {
        outline: 0.1875rem solid var(--alora-lime);
        outline-offset: 0.125rem;
      }
      .ui-nav-item.ui-active {
        border-color: var(--alora-lime);
        background: var(--alora-lime);
        color: var(--alora-forest);
      }
      .ui-nav-icon {
        position: relative;
        display: inline-grid;
        place-items: center;
        flex: 0 0 auto;
        width: 1.75rem;
        height: 1.75rem;
      }
      .ui-nav-badge {
        position: absolute;
        top: -0.35rem;
        right: -0.45rem;
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
      .ui-nav-copy {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: 0.15rem;
        min-width: 0;
      }
      .ui-nav-label {
        line-height: 1.2;
      }
      .ui-nav-hint {
        color: rgba(255, 255, 255, 0.72);
        font-size: 0.66rem;
        line-height: 1.2;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      .ui-nav-item.ui-active .ui-nav-hint {
        color: var(--alora-forest);
      }
      .ui-sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }

      /* Rail: icons only. */
      :host(.collapsed) nav {
        gap: 0.5rem;
        justify-items: center;
      }
      :host(.collapsed) .ui-nav-group + .ui-nav-group {
        border-top: 0.0625rem solid rgba(255, 255, 255, 0.12);
        padding-top: 0.5rem;
      }
      :host(.collapsed) .ui-nav-group-label,
      :host(.collapsed) .ui-nav-copy {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      :host(.collapsed) .ui-nav-item {
        justify-content: center;
        width: 2.75rem;
        min-height: 2.75rem;
        padding: 0;
        border-color: transparent;
        background: transparent;
      }
      :host(.collapsed) .ui-nav-item:hover {
        background: rgba(255, 255, 255, 0.12);
      }
      :host(.collapsed) .ui-nav-item.ui-active {
        background: var(--alora-lime);
      }
    `,
  ],
})
export class UiSideNavComponent implements AfterViewChecked {
  private readonly host = inject(ElementRef<HTMLElement>);
  private revealedKey: string | null = null;

  @Input() groups: UiNavGroup[] = [];
  @Input() activeKey: string | null = null;
  @Input() collapsed = false;
  @Input() ariaLabel = "Navigazione principale";
  @Output() readonly select = new EventEmitter<string>();

  /** Keeps the current page visible when the menu is taller than the screen. */
  ngAfterViewChecked(): void {
    const signature = `${this.activeKey}|${this.groups.length}|${this.collapsed}`;
    if (!this.activeKey || signature === this.revealedKey) return;
    this.revealedKey = signature;
    // After layout: the sidebar height is final only after this check.
    setTimeout(() => this.revealActive(), 60);
  }

  private revealActive(): void {
    const host = this.host.nativeElement as HTMLElement;
    const active = host.querySelector<HTMLElement>('[aria-current="page"]');
    let container = host.parentElement;
    while (container && !/(auto|scroll)/.test(getComputedStyle(container).overflowY)) {
      container = container.parentElement;
    }
    if (!active || !container) return;
    const item = active.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    const margin = 8;
    if (item.bottom > box.bottom) container.scrollTop += item.bottom - box.bottom + margin;
    else if (item.top < box.top) container.scrollTop -= box.top - item.top + margin;
  }

  itemAriaLabel(item: UiNavItem): string {
    return item.badge ? `${item.label}, ${item.badge} da gestire` : item.label;
  }

  trackGroup = (_: number, group: UiNavGroup) => group.id;
  trackItem = (_: number, item: UiNavItem) => item.key;
}
