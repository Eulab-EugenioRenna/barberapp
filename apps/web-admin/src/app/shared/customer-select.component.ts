import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from "@angular/core";
import { UiSelectComponent, type UiOption } from "@alora/ui";
import { CustomerDirectoryService, customerLabel } from "../core/customer-directory.service";

/**
 * The one customer picker of ALORA: all customers, filtered as you type.
 *
 * <alora-customer-select [value]="customerId" (valueChange)="customerId = $event" />
 * Filters add `allLabel="Tutti i clienti"`; WhatsApp uses `[withPhoneOnly]="true"`.
 */
@Component({
  selector: "alora-customer-select",
  standalone: true,
  imports: [CommonModule, UiSelectComponent],
  template: `
    <ui-select
      [value]="value"
      (valueChange)="valueChange.emit($event)"
      [options]="options()"
      [label]="label"
      [placeholder]="placeholder"
      [disabled]="disabled"
      filterPlaceholder="Cerca per nome o cognome"
      [emptyText]="emptyText"
      [createLabel]="createLabel"
      (createRequest)="createRequest.emit()"
      (opened)="directory.refreshIfStale()"
    ></ui-select>
  `,
})
export class CustomerSelectComponent implements OnInit {
  readonly directory = inject(CustomerDirectoryService);
  @Input() value = "";
  @Input() label = "Cliente";
  @Input() placeholder = "Cerca o scegli il cliente";
  @Input() disabled = false;
  @Input() createLabel = "";
  /** Adds a first option with an empty value, e.g. «Tutti i clienti» in a filter. */
  @Input() set allLabel(value: string) { this.all.set(value); }
  @Input() set withPhoneOnly(value: boolean) { this.phoneOnly.set(value); }
  /** A customer that may not be in the list yet (e.g. the one on an existing account). */
  @Input() set extra(value: { id: string; firstName?: string; lastName?: string } | null | undefined) { this.extraCustomer.set(value ?? null); }
  @Output() readonly valueChange = new EventEmitter<string>();
  @Output() readonly createRequest = new EventEmitter<void>();

  private readonly all = signal("");
  private readonly phoneOnly = signal(false);
  private readonly extraCustomer = signal<{ id: string; firstName?: string; lastName?: string } | null>(null);

  readonly options = computed<UiOption[]>(() => {
    const rows = this.directory.customers().filter((row) => !this.phoneOnly() || row.hasPhone);
    const extra = this.extraCustomer();
    const list: UiOption[] = rows.map((row) => ({ value: row.id, label: customerLabel(row) }));
    if (extra?.id && !rows.some((row) => row.id === extra.id)) list.unshift({ value: extra.id, label: customerLabel(extra) });
    return this.all() ? [{ value: "", label: this.all() }, ...list] : list;
  });

  get emptyText(): string {
    if (!this.directory.loaded()) return "Caricamento clienti…";
    return this.phoneOnly() ? "Nessun cliente con telefono: il numero si aggiunge nella scheda cliente" : "Nessun cliente trovato";
  }

  ngOnInit() {
    void this.directory.load();
  }
}
