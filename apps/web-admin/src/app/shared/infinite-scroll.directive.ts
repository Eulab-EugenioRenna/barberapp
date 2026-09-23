import {
  Directive,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnDestroy,
  OnInit,
  Output,
  inject,
} from "@angular/core";

/**
 * Emits `loadMore` when the host element scrolls into (or near) the viewport.
 * Place it on a sentinel element rendered after the list, e.g.
 * `<div barberInfiniteScroll (loadMore)="loadMore()"></div>`.
 */
@Directive({
  selector: "[barberInfiniteScroll]",
  standalone: true,
})
export class InfiniteScrollDirective implements OnInit, OnDestroy {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly zone = inject(NgZone);
  private observer?: IntersectionObserver;

  @Input() barberInfiniteScroll: boolean = true;
  @Input() scrollRootMargin = "200px";

  @Output() readonly loadMore = new EventEmitter<void>();

  ngOnInit(): void {
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        if (this.barberInfiniteScroll === false) {
          return;
        }

        if (entries.some((entry) => entry.isIntersecting)) {
          this.zone.run(() => this.loadMore.emit());
        }
      },
      { root: null, rootMargin: this.scrollRootMargin },
    );

    this.observer.observe(this.elementRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}