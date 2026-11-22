import { DOCUMENT } from "@angular/common";
import {
  ApplicationRef,
  ChangeDetectorRef,
  Directive,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnDestroy,
  Output,
  TemplateRef,
  ViewChild,
  inject,
} from "@angular/core";
import type { ControlValueAccessor } from "@angular/forms";
import { UiBodyPopover } from "./ui-body-popover";
import { uiOptionMatches, type UiOption } from "./ui-option";

let nextId = 0;

/**
 * Shared behaviour of select, multi-select and autocomplete: options,
 * filtering, keyboard (arrows, Home/End, Enter, Escape, Tab), the body popover
 * and ControlValueAccessor plumbing (works with ngModel and reactive forms).
 */
@Directive()
export abstract class UiListboxBase implements ControlValueAccessor, OnDestroy {
  protected readonly host = inject(ElementRef<HTMLElement>);
  protected readonly cdr = inject(ChangeDetectorRef);
  private readonly popover = new UiBodyPopover(
    inject(DOCUMENT),
    inject(ApplicationRef),
    inject(NgZone),
    () => this.anchorElement(),
    () => this.close(false),
  );

  readonly listboxId = `ui-listbox-${nextId++}`;

  @Input() options: UiOption[] = [];
  /** Visible label above the field; also used as accessible name. */
  @Input() label = "";
  @Input() placeholder = "Seleziona";
  @Input() disabled = false;
  /** Filter field inside the panel. */
  @Input() filterable = true;
  @Input() filterPlaceholder = "Filtra";
  @Input() emptyText = "Nessuna opzione";
  /** Shows a "+ …" action at the top of the panel (emits createRequest). */
  @Input() createLabel = "";
  /** Options come from the server: the filter only emits searchChange. */
  @Input() remoteSearch = false;
  @Input() loading = false;
  @Input() ariaLabel = "";

  @Output() readonly searchChange = new EventEmitter<string>();
  @Output() readonly createRequest = new EventEmitter<void>();
  @Output() readonly opened = new EventEmitter<void>();
  @Output() readonly closed = new EventEmitter<void>();

  @ViewChild("panel", { static: true }) protected panelTemplate!: TemplateRef<unknown>;

  open = false;
  query = "";
  activeIndex = -1;

  protected onChange: (value: any) => void = () => undefined;
  protected onTouched: () => void = () => undefined;
  private formDisabled = false;

  /** The panel element while open (it lives under <body>). */
  protected get panelElement(): HTMLElement | undefined {
    return this.popover.panel;
  }

  get isDisabled(): boolean {
    return (
      this.disabled ||
      this.formDisabled ||
      !!(this.host.nativeElement as HTMLElement).closest("fieldset[disabled]")
    );
  }

  get accessibleName(): string {
    return this.ariaLabel || this.label || this.placeholder;
  }

  get visibleOptions(): UiOption[] {
    if (this.remoteSearch || !this.query.trim()) return this.options;
    return this.options.filter((option) => uiOptionMatches(option, this.query));
  }

  readonly isSelectedFn = (option: UiOption) => this.isSelected(option);

  abstract isSelected(option: UiOption): boolean;
  abstract choose(option: UiOption): void;
  abstract writeValue(value: unknown): void;
  /** Element the panel is anchored to. */
  protected abstract anchorElement(): HTMLElement;
  /** Element that receives focus back when the panel closes. */
  protected abstract focusElement(): HTMLElement | null;

  registerOnChange(fn: (value: any) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(disabled: boolean): void {
    this.formDisabled = disabled;
    this.cdr.markForCheck();
  }

  toggle(): void {
    this.open ? this.close() : this.openPanel();
  }

  openPanel(): void {
    if (this.isDisabled || this.open) return;
    this.open = true;
    this.setQuery("");
    const selected = this.visibleOptions.findIndex((option) => this.isSelected(option));
    this.activeIndex = selected >= 0 ? selected : this.firstEnabled(0, 1);
    this.popover.open(this.panelTemplate);
    this.opened.emit();
  }

  close(restoreFocus = true): void {
    if (!this.open) return;
    this.open = false;
    this.popover.close();
    this.onTouched();
    this.closed.emit();
    this.cdr.markForCheck();
    if (restoreFocus) this.focusElement()?.focus({ preventScroll: true });
  }

  setQuery(query: string): void {
    this.query = query;
    if (this.remoteSearch) this.searchChange.emit(query);
    this.activeIndex = this.firstEnabled(0, 1);
    queueMicrotask(() => this.popover.position());
  }

  setActive(index: number): void {
    this.activeIndex = index;
  }

  requestCreate(): void {
    this.close();
    this.createRequest.emit();
  }

  /** Keyboard for both the trigger and the filter input. */
  onKey(event: KeyboardEvent): void {
    const options = this.visibleOptions;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!this.open) return this.openPanel();
        this.activeIndex = this.firstEnabled(this.activeIndex + 1, 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!this.open) return this.openPanel();
        this.activeIndex = this.firstEnabled(this.activeIndex - 1, -1);
        break;
      case "Home":
        if (!this.open) return;
        event.preventDefault();
        this.activeIndex = this.firstEnabled(0, 1);
        break;
      case "End":
        if (!this.open) return;
        event.preventDefault();
        this.activeIndex = this.firstEnabled(options.length - 1, -1);
        break;
      case "Enter":
        if (!this.open) {
          event.preventDefault();
          return this.openPanel();
        }
        if (options[this.activeIndex] && !options[this.activeIndex].disabled) {
          event.preventDefault();
          this.choose(options[this.activeIndex]);
        }
        break;
      case "Escape":
        if (this.open) {
          event.preventDefault();
          event.stopPropagation();
          this.close();
        }
        break;
      case "Tab":
        if (this.open) this.close(false);
        break;
    }
  }

  ngOnDestroy(): void {
    this.popover.close();
  }

  private firstEnabled(from: number, step: 1 | -1): number {
    const options = this.visibleOptions;
    if (!options.length) return -1;
    let index = Math.max(0, Math.min(from, options.length - 1));
    for (let tries = 0; tries < options.length; tries++) {
      if (!options[index].disabled) return index;
      index = (index + step + options.length) % options.length;
    }
    return -1;
  }
}

/** Styles of the body-level container shared by every dropdown. */
export const UI_POPOVER_STYLES = `
  .ui-pop {
    position: fixed;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    max-height: 20rem;
    overflow: hidden;
    border: 0.0625rem solid var(--line);
    border-radius: 1.1rem;
    background: #fff;
    box-shadow: 0 1.25rem 3rem rgba(30, 52, 37, 0.16);
    font-family: var(--font-body);
    font-size: 0.95rem;
    animation: ui-pop-in 120ms ease-out;
  }
  .ui-pop.ui-pop-sheet {
    left: 0;
    right: 0;
    bottom: 0;
    top: auto;
    width: auto;
    max-height: min(70dvh, 32rem);
    border-radius: 1.5rem 1.5rem 0 0;
    padding-bottom: env(safe-area-inset-bottom, 0px);
    /* The giant shadow is the backdrop: tapping it is an outside click. */
    box-shadow: 0 0 0 100vmax rgba(30, 52, 37, 0.42);
    animation: ui-sheet-in 160ms ease-out;
  }
  .ui-pop-sheet-title {
    display: none;
  }
  .ui-pop.ui-pop-sheet .ui-pop-sheet-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.9rem 1rem 0.4rem;
    font-weight: 700;
  }
  .ui-pop-sheet-title button {
    border: 0;
    border-radius: 999rem;
    background: rgba(30, 52, 37, 0.06);
    padding: 0.45rem 0.9rem;
    color: var(--ink);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  @keyframes ui-pop-in {
    from { opacity: 0; transform: translateY(-0.25rem); }
  }
  @keyframes ui-sheet-in {
    from { transform: translateY(100%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .ui-pop, .ui-pop.ui-pop-sheet { animation: none; }
  }
`;

/** Styles of the closed field (trigger), aligned with the legacy select look. */
export const UI_FIELD_STYLES = `
  :host { display: block; min-width: 0; }
  .ui-field-label {
    display: block;
    margin-bottom: 0.35rem;
    color: var(--muted);
    font-size: 0.75rem;
    font-weight: 700;
  }
  .ui-trigger {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    min-height: var(--ui-field-height, 2.9rem);
    border: 0.0625rem solid rgba(30, 52, 37, 0.14);
    border-radius: 1rem;
    background: #fff;
    padding: 0.5rem 0.85rem;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 160ms ease, box-shadow 160ms ease;
  }
  .ui-trigger:hover:not(:disabled) { border-color: rgba(30, 52, 37, 0.3); }
  .ui-trigger:focus-visible,
  .ui-trigger.ui-open {
    outline: none;
    border-color: rgba(30, 52, 37, 0.45);
    box-shadow: 0 0 0 0.2rem color-mix(in srgb, var(--focus) 35%, transparent);
  }
  .ui-trigger:disabled { opacity: 0.55; cursor: not-allowed; }
  .ui-trigger-value {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ui-placeholder { color: var(--muted); }
  .ui-chevron {
    flex: 0 0 auto;
    width: 1rem;
    height: 1rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 160ms ease;
  }
  .ui-open .ui-chevron { transform: rotate(180deg); }
`;
