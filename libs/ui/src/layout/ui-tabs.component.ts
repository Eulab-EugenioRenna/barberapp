import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  inject,
} from "@angular/core";

export interface UiTab {
  key: string;
  label: string;
}

/**
 * Splits one page into sections shown one at a time. The page renders the
 * panel itself with `role="tabpanel"`, `id="ui-tabpanel-{key}"` and
 * `aria-labelledby="ui-tab-{key}"`.
 *
 * Mobile: one scrollable row. Tablet+: inline segmented control.
 * Keyboard: arrows, Home and End move between tabs.
 */
@Component({
  selector: "ui-tabs",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="ui-tabs" role="tablist" [attr.aria-label]="ariaLabel">
    <button
      *ngFor="let tab of tabs; let index = index; trackBy: trackTab"
      type="button"
      role="tab"
      class="ui-tab"
      [attr.data-tour]="'tab-' + tab.key"
      [class.ui-active]="tab.key === active"
      [attr.id]="'ui-tab-' + tab.key"
      [attr.aria-selected]="tab.key === active"
      [attr.aria-controls]="'ui-tabpanel-' + tab.key"
      [attr.tabindex]="tab.key === active ? 0 : -1"
      (click)="choose(tab.key)"
      (keydown)="onKey($event, index)"
    >
      {{ tab.label }}
    </button>
  </div>`,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .ui-tabs {
        display: flex;
        gap: 0.35rem;
        overflow-x: auto;
        scrollbar-width: none;
        border: 0.0625rem solid var(--line);
        border-radius: 999rem;
        background: var(--panel);
        padding: 0.3rem;
      }
      .ui-tabs::-webkit-scrollbar {
        display: none;
      }
      .ui-tab {
        flex: 0 0 auto;
        min-height: 2.5rem;
        border: 0;
        border-radius: 999rem;
        background: transparent;
        padding: 0.5rem 1rem;
        color: var(--muted);
        font: inherit;
        font-weight: 700;
        white-space: nowrap;
        cursor: pointer;
        transition: 160ms ease;
      }
      .ui-tab:hover {
        background: rgba(30, 52, 37, 0.05);
        color: var(--ink);
      }
      .ui-tab:focus-visible {
        outline: 0.1875rem solid var(--focus);
        outline-offset: 0.125rem;
      }
      .ui-tab.ui-active {
        background: var(--alora-lime);
        color: var(--alora-forest);
      }
      @media (min-width: 48rem) {
        .ui-tabs {
          display: inline-flex;
          max-width: 100%;
        }
      }
    `,
  ],
})
export class UiTabsComponent {
  @Input() tabs: UiTab[] = [];
  @Input() active = "";
  @Input() ariaLabel = "Sezioni della pagina";
  @Output() readonly activeChange = new EventEmitter<string>();

  private readonly host = inject(ElementRef<HTMLElement>);

  choose(key: string): void {
    if (key !== this.active) this.activeChange.emit(key);
  }

  onKey(event: KeyboardEvent, index: number): void {
    const last = this.tabs.length - 1;
    const target =
      event.key === "ArrowRight"
        ? (index + 1) % this.tabs.length
        : event.key === "ArrowLeft"
          ? (index - 1 + this.tabs.length) % this.tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    if (target < 0) return;
    event.preventDefault();
    this.choose(this.tabs[target].key);
    const buttons = (this.host.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      '[role="tab"]',
    );
    buttons[target]?.focus();
  }

  trackTab = (_: number, tab: UiTab) => tab.key;
}
