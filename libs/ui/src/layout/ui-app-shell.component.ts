import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
} from "@angular/core";

/**
 * Application frame. Projection slots:
 *   [uiShellSidebar]   navigation surface (dark)
 *   [uiShellTopbar]    context bar above the content (hidden when empty)
 *   (default)          page content, the only scroll container
 *   [uiShellBottomNav] thumb bar, shown on mobile only
 *
 * Layout per viewport:
 *   mobile  (<48rem)  sidebar is an off-canvas drawer (`drawerOpen`)
 *   tablet+ (>=48rem) sidebar is a persistent column; `rail` makes it narrow
 */
@Component({
  selector: "ui-app-shell",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    "[class.rail]": "rail",
    "[class.drawer-open]": "drawerOpen",
  },
  template: `<a class="ui-skip-link" href="#ui-shell-main" (click)="focusMain($event)">Vai al contenuto</a>
    <button
      *ngIf="drawerOpen"
      type="button"
      class="ui-shell-backdrop"
      aria-label="Chiudi menu"
      (click)="closeDrawer()"
    ></button>
    <aside class="ui-shell-sidebar" [attr.aria-label]="sidebarLabel">
      <ng-content select="[uiShellSidebar]"></ng-content>
    </aside>
    <div class="ui-shell-column">
      <div class="ui-shell-topbar"><ng-content select="[uiShellTopbar]"></ng-content></div>
      <main id="ui-shell-main" class="ui-shell-main" tabindex="-1">
        <ng-content></ng-content>
      </main>
    </div>
    <div class="ui-shell-bottom"><ng-content select="[uiShellBottomNav]"></ng-content></div>`,
  styles: [
    `
      :host {
        --ui-shell-gap: 1rem;
        --ui-shell-pad: 0.75rem;
        --ui-sidebar-width: 19rem;
        --ui-rail-width: 4.5rem;
        --ui-bottom-nav-space: calc(4.75rem + env(safe-area-inset-bottom, 0px));
        position: relative;
        display: flex;
        width: 100%;
        height: 100vh;
        height: 100dvh;
        overflow: hidden;
        background: var(--bg);
      }
      .ui-skip-link {
        position: absolute;
        top: -10rem;
        left: 1rem;
        z-index: 60;
        border-radius: 999rem;
        background: var(--alora-lime);
        padding: 0.6rem 1rem;
        color: var(--alora-forest);
        font-weight: 700;
      }
      .ui-skip-link:focus {
        top: 1rem;
      }
      .ui-shell-backdrop {
        position: fixed;
        inset: 0;
        z-index: 39;
        border: 0;
        background: rgba(30, 52, 37, 0.42);
      }

      /* Mobile: drawer. */
      .ui-shell-sidebar {
        --accent: var(--alora-lime);
        --focus: var(--alora-lime);
        position: fixed;
        inset: 0 auto 0 0;
        z-index: 40;
        display: flex;
        flex-direction: column;
        width: min(88%, var(--ui-sidebar-width));
        padding: calc(1rem + env(safe-area-inset-top, 0px)) 1rem
          calc(1rem + env(safe-area-inset-bottom, 0px));
        overflow: hidden;
        background: var(--alora-forest);
        box-shadow: 0 0.75rem 2.5rem rgba(30, 52, 37, 0.16);
        color: #fff;
        transform: translateX(-100%);
        visibility: hidden;
        transition:
          transform 180ms ease,
          visibility 0s linear 180ms,
          width 180ms ease,
          padding 180ms ease;
      }
      :host(.drawer-open) .ui-shell-sidebar {
        transform: translateX(0);
        visibility: visible;
        transition:
          transform 180ms ease,
          visibility 0s;
      }
      .ui-shell-column {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: 0.75rem;
        min-width: 0;
        height: 100%;
        padding: calc(var(--ui-shell-pad) + env(safe-area-inset-top, 0px))
          calc(var(--ui-shell-pad) + env(safe-area-inset-right, 0px)) 0
          calc(var(--ui-shell-pad) + env(safe-area-inset-left, 0px));
      }
      .ui-shell-topbar {
        flex: 0 0 auto;
      }
      .ui-shell-topbar:empty {
        display: none;
      }
      .ui-shell-main {
        flex: 1 1 auto;
        min-height: 0;
        min-width: 0;
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        padding-bottom: var(--ui-bottom-nav-space);
        outline: none;
      }
      .ui-shell-bottom {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 38;
      }

      /* Tablet: persistent sidebar, no bottom bar. */
      @media (min-width: 48rem) {
        :host {
          --ui-shell-pad: 1rem;
          gap: var(--ui-shell-gap);
          padding: var(--ui-shell-pad);
        }
        .ui-shell-backdrop,
        .ui-shell-bottom {
          display: none;
        }
        .ui-shell-sidebar {
          position: relative;
          inset: auto;
          z-index: auto;
          flex: 0 0 var(--ui-sidebar-width);
          width: var(--ui-sidebar-width);
          height: 100%;
          padding: 1rem;
          border-radius: 2rem;
          transform: none;
          visibility: visible;
          transition:
            width 180ms ease,
            flex-basis 180ms ease,
            padding 180ms ease;
        }
        :host(.rail) .ui-shell-sidebar {
          flex-basis: var(--ui-rail-width);
          width: var(--ui-rail-width);
          padding-inline: 0.5rem;
        }
        .ui-shell-column {
          padding: 0;
          gap: var(--ui-shell-gap);
        }
        .ui-shell-main {
          padding-bottom: 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .ui-shell-sidebar {
          transition: none;
        }
      }
    `,
  ],
})
export class UiAppShellComponent {
  @Input() rail = false;
  @Input() drawerOpen = false;
  @Input() sidebarLabel = "Menu";
  @Output() readonly drawerOpenChange = new EventEmitter<boolean>();

  @HostListener("document:keydown.escape")
  onEscape(): void {
    if (this.drawerOpen) this.closeDrawer();
  }

  closeDrawer(): void {
    this.drawerOpenChange.emit(false);
  }

  focusMain(event: Event): void {
    event.preventDefault();
    (
      (event.target as HTMLElement).ownerDocument.getElementById(
        "ui-shell-main",
      ) as HTMLElement | null
    )?.focus();
  }
}
