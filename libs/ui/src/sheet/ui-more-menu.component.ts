import { CommonModule } from "@angular/common";
import {
  Component,
  ElementRef,
  HostListener,
  Input,
  ViewEncapsulation,
  inject,
} from "@angular/core";

/**
 * «…» button with the secondary actions of a row. Project `<button>`s; any
 * click inside the menu closes it, so does a click outside or Escape.
 * Rule: one main action on the row, everything else in here.
 */
@Component({
  selector: "ui-more-menu",
  standalone: true,
  imports: [CommonModule],
  encapsulation: ViewEncapsulation.None,
  host: { class: "ui-more" },
  template: `<button
      type="button"
      class="ui-more-trigger"
      aria-haspopup="menu"
      [attr.aria-expanded]="open"
      [attr.aria-label]="label"
      (click)="open = !open; $event.stopPropagation()"
    >
      …
    </button>
    <div
      class="ui-more-menu"
      role="menu"
      [hidden]="!open"
      (click)="open = false"
    >
      <ng-content></ng-content>
    </div>`,
})
export class UiMoreMenuComponent {
  @Input() label = "Altre azioni";
  open = false;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  @HostListener("document:click", ["$event"])
  onDocumentClick(event: Event): void {
    if (this.open && !this.host.nativeElement.contains(event.target as Node))
      this.open = false;
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    this.open = false;
  }
}
