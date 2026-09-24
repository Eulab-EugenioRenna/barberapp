import { DOCUMENT } from "@angular/common";
import {
  AfterViewInit,
  Directive,
  ElementRef,
  OnDestroy,
  inject,
} from "@angular/core";
import { focusFirstAvailableControl, restoreFocus } from "./autofocus-first";

@Directive({
  selector: "[barberAutofocusFirst]",
  standalone: true,
})
export class AutofocusFirstDirective implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly previouslyFocused = this.document
    .activeElement as HTMLElement | null;
  private focusTimer: ReturnType<typeof setTimeout> | null = null;

  ngAfterViewInit(): void {
    this.focusTimer = setTimeout(() => {
      focusFirstAvailableControl(this.host.nativeElement);
      this.focusTimer = null;
    });
  }

  ngOnDestroy(): void {
    if (this.focusTimer) {
      clearTimeout(this.focusTimer);
    }
    restoreFocus(this.previouslyFocused);
  }
}
