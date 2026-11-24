import { wholeQuantity } from "./quick-order-quantity";
import { CreateRecoveryService } from "../core/create-recovery.service";
import { AccountPaymentsComponent } from "../shared/account-payments.component";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { ADMIN_API_URL } from "../core/api-config";
import { AdminApiService } from "../core/admin-api.service";
import { OperationalContextService } from "../core/operational-context.service";
import { SectorPickerComponent } from "../shared/sector-picker.component";
import { offeredAt, sectorForActivity } from "../core/activity-placement";
import { FunctionAccessDirective } from "../shared/function-access.directive";
import { SessionStore } from "../core/session.store";
import { CustomerDirectoryService } from "../core/customer-directory.service";
import { CustomerSelectComponent } from "../shared/customer-select.component";
import { CommonModule } from "@angular/common";
import {
  Component,
  inject,
  EventEmitter,
  HostListener,
  Input,
  OnInit,
  OnDestroy,
  Output,
  HostBinding,
  ViewChild,
  ElementRef,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { UiSelectComponent, uiOptions, type UiOption } from "@alora/ui";
import {
  QuickCreateDialogComponent,
  QuickCreateKind,
} from "../quick-create-dialog.component";
import { AutofocusFirstDirective } from "../shared/autofocus-first.directive";
import { BarcodeScannerService } from "../core/barcode-scanner.service";

@Component({
  selector: "barber-quick-order-modal",
  standalone: true,
  imports: [
    CustomerSelectComponent,
    AccountPaymentsComponent,
    FunctionAccessDirective,
    SectorPickerComponent,
    CommonModule,
    FormsModule,
    UiSelectComponent,
    QuickCreateDialogComponent,
    AutofocusFirstDirective,
  ],
  templateUrl: "./quick-order-modal.component.html",
  styleUrl: "./quick-order-modal.component.css",
})
export class QuickOrderModalComponent implements OnInit, OnDestroy {
  readonly context = inject(OperationalContextService);
  readonly creations = inject(CreateRecoveryService);
  readonly scanner = inject(BarcodeScannerService);
  readonly adminApi = inject(AdminApiService);
  locationId = "";
  private readonly http = inject(HttpClient);
  orderDiscount = "0";
  quote: any = null;
  quoteBusy = false;
  quoteError = "";
  scanFeedback = "";
  scanFeedbackKind: "ok" | "error" | "info" = "ok";
  private quoteTimer: ReturnType<typeof setTimeout> | null = null;
  private quoteGeneration = 0;
  readonly session = inject(SessionStore);
  private readonly customerDirectory = inject(CustomerDirectoryService);

  protected readonly Number = Number;
  @Input() customers: any[] = [];
  @Input() services: any[] = [];
  @Input() products: any[] = [];
  @Input() collaborators: any[] = [];
  @Input() defaultCollaboratorId = "";
  @Input() appointment: any = null;
  @Input() sale: any = null;
  @Input() loading = false;

  @HostBinding("class.quick-order-entering") entering = true;

  @ViewChild("cartScroll") cartScroll?: ElementRef<HTMLElement>;

  @Output() close = new EventEmitter<void>();

  destroyed = false;
  quickCreatePrefill: { barcode?: string } | null = null;
  private finishBarcodeCreation: (() => void) | null = null;

  @Output() retryCreation = new EventEmitter<void>();
  @Output() retryUpdate = new EventEmitter<void>();
  @Output() submitOrder = new EventEmitter<Record<string, unknown>>();
  @Output() catalogChanged = new EventEmitter<void>();
  @Output() customerSearchChange = new EventEmitter<string>();

  customerId = "";
  appointmentId = "";
  /** "Eseguito il / alle" (datetime-local); empty = the services end now. */
  performedAt = "";
  paymentPending = false;
  paymentMethod = "cash";
  paymentStatus = "paid";
  items: any[] = [];
  pricePadIndex = -1;
  quickCreateKind: QuickCreateKind | null = null;
  private readonly createdCustomers: any[] = [];
  private readonly createdServices: any[] = [];
  private readonly createdProducts: any[] = [];
  private scannerDetach: (() => void) | null = null;
  online = typeof navigator !== "undefined" && navigator.onLine;

  @HostListener("document:keydown.escape")
  closeOnEscape(): void {
    if (this.quickCreateKind) return;
    if (!this.loading) this.close.emit();
  }

  ngOnInit(): void {
    this.locationId =
      this.sale?.locationId ||
      this.appointment?.locationId ||
      this.context.selected.locationId ||
      "";
    if (!this.context.locations().length)
      void this.context.load().catch(() => undefined);
    this.  attachScanner();
    setTimeout(() => {
      this.entering = false;
    }, 220);
    this.restoreCartScroll();
    if (this.sale) {
      this.orderDiscount = String(this.sale.orderDiscount ?? 0);
      this.customerId = this.sale.customerId || this.sale.customer?.id || "";
      this.appointmentId = this.sale.appointmentId || "";
      this.paymentMethod = this.sale.paymentMethod || "cash";
      this.paymentStatus =
        this.sale.orderStatus === "open"
          ? "paid"
          : this.sale.paymentStatus || "paid";
      this.items = (this.sale.items || []).map((item: any) => ({
        id: item.id,
        sectorId: item.sectorId,
        kind: item.serviceId ? "service" : "product",
        serviceId: item.serviceId || undefined,
        productId: item.productId || undefined,
        label: item.service?.name || item.product?.name || item.label,
        discount: Number(item.discount || 0),
        taxTotal: Number(item.taxTotal || 0),
        priceMode: item.priceMode || "legacy",
        vatRate: item.vatRate ?? "",
        priceOverrideReason: item.priceOverrideReason || "",
        quantity: Number(item.quantity || 1),
        unitPrice: Number(item.unitPrice || 0),
        collaboratorId: item.collaboratorId || item.collaborator?.id || "",
        originalCollaboratorId: item.collaboratorId || null,
        booking: item.booking || null,
        nonPerformanceChargeReason: item.nonPerformanceChargeReason || "",
      }));
      if (this.sale.orderStatus === "cancelled") return;
      this.queueQuote();
      return;
    }
    if (!this.appointment) {
      return;
    }
    this.appointmentId = this.appointment.id;
    this.customerId =
      this.appointment.customerId || this.appointment.customer?.id || "";
    if (this.appointment.service) {
      this.addService(this.appointment.service);
      this.items[0].sectorId =
        this.appointment.sectorId || this.items[0].sectorId;
    }
  }

  @HostListener("window:online")
  onOnline() {
    this.online = true;
  }
  @HostListener("window:offline")
  onOffline() {
    this.online = false;
  }

  readonly priceModeOptions: UiOption[] = [
    { value: "legacy", label: "Valore storico" },
    { value: "net", label: "IVA esclusa" },
    { value: "gross", label: "IVA inclusa" },
  ];
  readonly paymentMethodOptions: UiOption[] = [
    { value: "cash", label: "Contanti" },
    { value: "card", label: "Carta" },
    { value: "bank", label: "Bonifico ricevuto" },
    { value: "other", label: "Altro" },
  ];
  readonly paymentStatusOptions: UiOption[] = [
    { value: "paid", label: "Pagato" },
    { value: "unpaid", label: "Da pagare" },
  ];
  private locationOptionsSource: unknown;
  private locationOptionsCache: UiOption[] = [];
  /** Rebuilt only when the operational context publishes a new list. */
  get locationOptions(): UiOption[] {
    const locations = this.context.locations();
    if (locations !== this.locationOptionsSource) {
      this.locationOptionsSource = locations;
      this.locationOptionsCache = uiOptions(
        locations,
        (location) => location.id,
        (location) => location.name,
      );
    }
    return this.locationOptionsCache;
  }

  private customerOptionsKey: unknown[] = [];
  private customerOptionsCache: UiOption[] = [];
  /** Rebuilt only when its sources change: a new array per check re-renders the open list. */
  get customerOptions(): UiOption[] {
    const selectedCustomer = this.sale?.customer || this.appointment?.customer;
    const key = [this.customers, selectedCustomer, this.createdCustomers.length, this.createdCustomers[0]];
    if (key.length === this.customerOptionsKey.length && key.every((part, i) => part === this.customerOptionsKey[i]))
      return this.customerOptionsCache;
    this.customerOptionsKey = key;
    return (this.customerOptionsCache = this.uniqueEntities([
      ...this.createdCustomers,
      ...(selectedCustomer ? [selectedCustomer] : []),
      ...this.customers,
    ]).map((customer) => ({
      value: customer.id,
      label: `${customer.firstName} ${customer.lastName}`.trim(),
    })));
  }

  /** Sector of the service's activity at the account's location. */
  private serviceSectorId(service: any): string {
    return (
      sectorForActivity(this.context.sectors, service?.activityId, this.locationId)?.id ||
      service?.sectorId ||
      ""
    );
  }

  /**
   * Another location runs other activities: new lines move to its sectors and
   * services it does not offer leave the account (with a notice).
   */
  changeLocation(locationId: string): void {
    if (locationId === this.locationId) return;
    this.locationId = locationId;
    const removed: string[] = [];
    this.items = this.items.filter((item) => {
      if (item.id) return true;
      if (item.kind === "service") {
        const service = this.catalogServices.find((row) => row.id === item.serviceId) ||
          this.services.find((row) => row.id === item.serviceId);
        if (service && !offeredAt(this.context.sectors, service, locationId)) {
          removed.push(item.label);
          return false;
        }
        item.sectorId = this.serviceSectorId(service);
        return true;
      }
      const product = this.catalogProducts.find((row) => row.id === item.productId);
      item.sectorId =
        sectorForActivity(this.context.sectors, product?.activityId, locationId)?.id || "";
      return true;
    });
    if (removed.length)
      this.showScanFeedback(
        "info",
        `Tolti dal conto perché non previsti in questa sede: ${removed.join(", ")}`,
      );
    this.queueQuote();
  }

  collaboratorOptionsFor(item: any) {
    const sectorId =
      item.sectorId ||
      this.serviceSectorId(
        this.catalogServices.find((service) => service.id === item.serviceId),
      );
    const eligible = new Set(
      this.collaborators
        .filter(
          (person) =>
            !sectorId ||
            person.sectors?.some(
              (membership: any) => membership.sectorId === sectorId,
            ),
        )
        .map((person) => person.id),
    );
    const options = [
      { value: "", label: "Nessun collaboratore" },
      ...this.collaboratorOptions.filter((option) =>
        eligible.has(option.value),
      ),
    ];
    if (
      item.collaboratorId &&
      !options.some((option) => option.value === item.collaboratorId)
    ) {
      const recorded = this.sale?.items?.find(
        (row: any) => row.id === item.id,
      )?.collaborator;
      options.push({
        value: item.collaboratorId,
        label: recorded
          ? `${recorded.firstName} ${recorded.lastName}`.trim() + " (storico)"
          : "Collaboratore registrato (storico)",
      });
    }
    return options;
  }

  get collaboratorOptions() {
    return [...this.collaborators]
      .sort((left, right) => {
        if (left.id === this.defaultCollaboratorId) return -1;
        if (right.id === this.defaultCollaboratorId) return 1;
        return `${left.firstName} ${left.lastName}`.localeCompare(
          `${right.firstName} ${right.lastName}`,
          "it",
        );
      })
      .map((collaborator) => ({
        value: collaborator.id,
        label:
          `${collaborator.firstName} ${collaborator.lastName}`.trim() +
          (collaborator.id === this.defaultCollaboratorId
            ? " · riferimento"
            : ""),
      }));
  }

  get catalogServices(): any[] {
    return this.uniqueEntities([
      ...this.createdServices,
      ...this.services,
    ]).filter(
      (service) =>
        service.isActive !== false &&
        // Only services whose activity runs at this location can be chosen.
        offeredAt(this.context.sectors, service, this.locationId),
    );
  }
  get catalogProducts(): any[] {
    return this.uniqueEntities([
      ...this.createdProducts,
      ...this.products,
    ]).filter((row) => row.isActive !== false);
  }

  onQuickCreated(event: { kind: QuickCreateKind; entity: any }): void {
    if (event.kind === "customer") {
      this.createdCustomers.unshift(event.entity);
      this.customerDirectory.add(event.entity);
      this.customerId = event.entity.id;
    } else if (event.kind === "service") {
      this.createdServices.unshift(event.entity);
      this.addService(event.entity);
    } else {
      this.createdProducts.unshift(event.entity);
      const existing =
        this.quickCreatePrefill?.barcode &&
        this.items.find(
          (item) => item.kind === "product" && item.productId === event.entity.id,
        );
      if (existing) {
        existing.quantity = Number(existing.quantity || 1) + 1;
        this.queueQuote();
      } else {
        this.addProduct(event.entity);
      }
    }
    this.cancelQuickCreate();
    this.catalogChanged.emit();
  }

  cancelQuickCreate(): void {
    this.quickCreateKind = null;
    this.quickCreatePrefill = {};
    const resolve = this.finishBarcodeCreation;
    this.finishBarcodeCreation = null;
    if (resolve) resolve();
  }

  private uniqueEntities(items: any[]): any[] {
    const ids = new Set<string>();
    return items.filter((item) => {
      if (!item?.id || ids.has(item.id)) return false;
      ids.add(item.id);
      return true;
    });
  }

  get total(): number {
    return Number(this.quote?.total ?? 0);
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.cancelQuickCreate();
    if (this.quoteTimer) clearTimeout(this.quoteTimer);
    this.quoteGeneration++;
    if (this.scannerDetach) this.scannerDetach();
    this.scannerDetach = null;
  }
  priceHistory: any[] = [];
  priceHistoryMore = false;
  priceHistoryFeedback = "";
  private priceHistoryPage = 1;
  async loadPriceHistory(append = false) {
    if (!this.sale?.id) return;
    this.priceHistoryFeedback = "";
    if (!append) this.priceHistoryPage = 1;
    try {
      const result = await firstValueFrom(
        this.http.get<any>(
          `${ADMIN_API_URL}/sales/${this.sale.id}/price-history`,
          { params: { page: String(this.priceHistoryPage) } },
        ),
      );
      this.priceHistory = append
        ? [...this.priceHistory, ...result.items]
        : result.items;
      this.priceHistoryMore = result.hasMore;
    } catch (error: any) {
      this.priceHistoryFeedback =
        error?.error?.message || "Storico prezzi non disponibile";
    }
  }
  morePriceHistory() {
    this.priceHistoryPage++;
    return this.loadPriceHistory(true);
  }
  private itemPayload() {
    return this.items.map((item) => ({
      id: item.id,
      sectorId: item.sectorId,
      kind: item.kind,
      productId: item.productId,
      serviceId: item.serviceId,
      collaboratorId:
        item.kind === "service" ? item.collaboratorId || null : undefined,
      nonPerformanceChargeReason:
        item.kind === "service"
          ? item.nonPerformanceChargeReason?.trim() || null
          : undefined,
      quantity: wholeQuantity(item.quantity),
      unitPrice: String(item.unitPrice),
      discount: String(item.discount ?? 0),
      taxTotal: String(item.taxTotal ?? 0),
      priceMode: item.priceMode || "legacy",
      vatRate: item.vatRate === "" ? null : item.vatRate,
      priceOverrideReason: item.priceOverrideReason || undefined,
    }));
  }
  /** The line being edited stays whole in view instead of half under the bar. */
  revealLine(event: FocusEvent): void {
    const line = event.currentTarget as HTMLElement | null;
    line?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
    /** Quantity typed in the cart: whole number, at least 1, written back on blur. */
  fixQuantity(item: any): void {
    const quantity = wholeQuantity(item.quantity);
    if (item.quantity !== quantity) {
      item.quantity = quantity;
      this.queueQuote();
    }
  }
  /** A service is one performance per line; legacy lines with more stay editable. */
  quantityEditable(item: any): boolean {
    return item.kind !== "service" || Number(item.quantity) !== 1;
  }

  queueQuote() {
    if (this.quoteTimer) clearTimeout(this.quoteTimer);
    const generation = ++this.quoteGeneration;
    this.quote = null;
    this.quoteError = "";
    if (!this.items.length) {
      this.quoteBusy = false;
      return;
    }
    this.quoteBusy = true;
    this.quoteTimer = setTimeout(async () => {
      try {
        const result = await firstValueFrom(
          this.http.post(`${ADMIN_API_URL}/sales/quote`, {
            saleId: this.sale?.id,
            items: this.itemPayload(),
            orderDiscount: String(this.orderDiscount || 0),
            // Warnings (overlaps, hours) are computed on the actual slot.
            servicesStartAt: this.hasNewServices
              ? this.servicesStartAt().toISOString()
              : undefined,
          }),
        );
        if (generation === this.quoteGeneration) this.quote = result;
      } catch (error: any) {
        if (generation === this.quoteGeneration)
          this.quoteError =
            error?.error?.message || "Calcolo del conto non disponibile";
      } finally {
        if (generation === this.quoteGeneration) this.quoteBusy = false;
      }
    }, 200);
  }

  get totalServiceDurationMinutes(): number {
    return this.items.reduce((sum, item) => {
      if (item.kind !== "service") return sum;
      const service =
        this.services.find((entry) => entry.id === item.serviceId) ??
        this.createdServices.find((entry) => entry.id === item.serviceId);
      return (
        sum + Number(service?.durationMinutes || 0) * Number(item.quantity || 1)
      );
    }, 0);
  }

  /**
   * L'ordine viene registrato a consuntivo: l'appuntamento termina adesso e
   * inizia indietro della durata totale dei servizi, cosi il calendario
   * racconta una storia realistica invece di un blocco a orario fisso.
   */
  /** Service lines not yet in the agenda: confirming creates their appointment. */
  get newServiceItems(): any[] {
    return this.items.filter((item) => item.kind === "service" && !item.booking);
  }

  get hasNewServices(): boolean {
    return this.newServiceItems.length > 0;
  }

  get newServiceDurationMinutes(): number {
    return this.newServiceItems.reduce((sum, item) => {
      const service =
        this.services.find((entry) => entry.id === item.serviceId) ??
        this.createdServices.find((entry) => entry.id === item.serviceId);
      return sum + Number(service?.durationMinutes || 0);
    }, 0);
  }

  /** Start of the first new service: the chosen time, or "ending now". */
  servicesStartAt(): Date {
    if (this.performedAt) return new Date(this.performedAt);
    return new Date(Date.now() - this.newServiceDurationMinutes * 60_000);
  }

  get performedAtMax(): string {
    return toLocalInput(new Date());
  }

  get performedAtError(): string {
    if (!this.performedAt) return "";
    const value = new Date(this.performedAt);
    if (Number.isNaN(value.getTime())) return "Orario non valido";
    if (value.getTime() > Date.now() + 5 * 60_000)
      return "La cassa registra servizi già eseguiti: per un orario futuro usa «Prenota».";
    return "";
  }

  get scheduleWarnings(): string[] {
    return (this.quote?.warnings ?? []).map((warning: any) => warning.message);
  }

  setPerformedAt(value: string): void {
    this.performedAt = value;
    this.queueQuote();
  }

  get appointmentWindowLabel(): string {
    const durationMinutes = this.newServiceDurationMinutes;
    if (!durationMinutes) return "";
    const startsAt = this.servicesStartAt();
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    const time = (value: Date) =>
      value.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    const sameDay = startsAt.toDateString() === new Date().toDateString();
    const day = sameDay
      ? "oggi"
      : startsAt.toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit" });
    return `${day}, ${time(startsAt)} – ${time(endsAt)}`;
  }

  get isLinkedToAppointment(): boolean {
    return Boolean(this.appointmentId);
  }

  get isEditing(): boolean {
    return Boolean(this.sale?.id);
  }

  addService(service: any): void {
    if (!this.locationId)
      this.locationId =
        service.sector?.locationId ||
        this.context.sectors.find((sector) => sector.id === service.sectorId)
          ?.locationId ||
        "";
    this.items.push({
      kind: "service",
      serviceId: service.id,
      label: service.name,
      quantity: 1,
      sectorId: this.serviceSectorId(service),
      unitPrice: Number(service.basePrice || 0),
      priceMode: service.priceMode || "legacy",
      vatRate: service.vatRate ?? "",
      priceOverrideReason: "",
      discount: 0,
      taxTotal: 0,
      collaboratorId: "",
      nonPerformanceChargeReason: "",
    });
    this.queueQuote();
  }

  addProduct(product: any): void {
    const requiresPrice = product.price === null || product.price === undefined;
    this.items.push({
      kind: "product",
      productId: product.id,
      label: product.name,
      quantity: 1,
      // Its own activity here if it runs here; otherwise chosen on the line.
      sectorId:
        sectorForActivity(this.context.sectors, product.activityId, this.locationId)?.id || "",
      unitPrice: requiresPrice ? "" : Number(product.price),
      priceMode: product.priceMode || "legacy",
      vatRate: product.vatRate ?? "",
      priceOverrideReason: "",
      discount: 0,
      taxTotal: 0,
      requiresPrice,
    });
    if (requiresPrice) this.pricePadIndex = this.items.length - 1;
    this.queueQuote();
  }

  private attachScanner(): void {
    this.scanner.setOptions({
      scanThresholdMs: 120,
      terminatorKey: "Enter",
      soundEnabled: false,
      vibrationEnabled: false,
    });
    this.scannerDetach = this.scanner.attach((event) =>
      this.handleScannedBarcode(event.barcode),
    );
  }

  private async unknownBarcode(barcode: string): Promise<void> {
    if (!this.session.can("services.manage")) {
      this.showScanFeedback(
        "info",
        "Prodotto non trovato. Chiedi a chi gestisce il listino di associarlo.",
      );
      return;
    }
    this.showScanFeedback(
      "info",
      "Prodotto non trovato: crea un prodotto o associa il barcode",
    );
    this.quickCreatePrefill = { barcode };
    this.quickCreateKind = "product";
    // Keep subsequent scans queued until the unknown product is resolved or dismissed.
    await new Promise<void>((resolve) => {
      this.finishBarcodeCreation = resolve;
    });
  }

  private async handleScannedBarcode(barcode: string): Promise<void> {
    if (
      this.destroyed ||
      this.loading ||
      this.quickCreateKind ||
      this.sale?.orderStatus === "cancelled" ||
      this.writeState.kind !== "empty"
    )
      return;
    this.scanFeedback = "";
    if (!this.locationId) {
      this.showScanFeedback("error", "Seleziona una sede prima di scansionare");
      return;
    }
    const locationId = this.locationId;
    try {
      const product = await firstValueFrom(
        this.adminApi.findProductByBarcode(barcode),
      );
      if (
        this.destroyed ||
        this.loading ||
        this.quickCreateKind ||
        locationId !== this.locationId ||
        this.writeState.kind !== "empty"
      )
        return;
      if (!product?.id) return await this.unknownBarcode(barcode);
      if (product.isActive === false) {
        this.showScanFeedback("error", "Il prodotto scansionato non è attivo");
        return;
      }
      const existing = this.items.find(
        (item) => item.kind === "product" && item.productId === product.id,
      );
      if (existing) {
        existing.quantity = Number(existing.quantity || 1) + 1;
        this.queueQuote();
      } else {
        this.addProduct(product);
      }
      this.showScanFeedback("ok", `Scansione: ${product.name}`);
    } catch (error: any) {
      if (this.destroyed || this.loading || this.quickCreateKind || locationId !== this.locationId || this.writeState.kind !== "empty") return;
      if (error?.status === 404) return await this.unknownBarcode(barcode);
      this.showScanFeedback(
        "error",
        error?.status === 0
          ? "Rete assente. Riprova la scansione quando la connessione è disponibile."
          : error?.error?.message || "Scansione non riuscita. Riprova.",
      );
    }
  }

  private showScanFeedback(
    kind: "ok" | "error" | "info",
    message: string,
  ): void {
    this.scanFeedback = message;
    this.scanFeedbackKind = kind;
    setTimeout(() => {
      if (this.scanFeedback === message) this.scanFeedback = "";
    }, 2500);
  }

  private saveCartScroll(): void {
    try {
      const el = this.cartScroll?.nativeElement;
      if (!el) return;
      sessionStorage.setItem(
        "barber.quick-order.cart-scroll",
        String(el.scrollTop),
      );
    } catch {
      /* sessionStorage non disponibile: ignora */
    }
  }

  private restoreCartScroll(): void {
    try {
      const raw = sessionStorage.getItem("barber.quick-order.cart-scroll");
      const top = raw ? Number(raw) : 0;
      if (!top || !this.cartScroll?.nativeElement) return;
      const el = this.cartScroll.nativeElement;
      el.scrollTop = top;
    } catch {
      /* scroll restore non disponibile: ignora */
    }
  }

  removeItem(index: number): void {
    if (this.items[index]?.booking) return;
    if (!this.confirmDestructive("Rimuovi questa riga dal conto?")) return;
    this.items.splice(index, 1);
    this.queueQuote();
    if (this.pricePadIndex === index) this.pricePadIndex = -1;
    if (this.pricePadIndex > index) this.pricePadIndex -= 1;
  }

  /** Conferma su azioni distruttive. Overridabile nei test. */
  protected confirmDestructive(message: string): boolean {
    return window.confirm(message);
  }

  appendPrice(value: string): void {
    const item = this.items[this.pricePadIndex];
    if (!item) return;
    const current = String(item.unitPrice ?? "");
    if (value === "." && current.includes(".")) return;
    item.unitPrice = `${current}${value}`;
    this.queueQuote();
  }

  clearPrice(): void {
    const item = this.items[this.pricePadIndex];
    if (item) item.unitPrice = "";
    this.queueQuote();
  }

  get writeState() {
    return this.sale?.id
      ? this.creations.state("sale-update", this.sale.id)
      : this.creations.state("sale");
  }
  nonPerformed(item: any) {
    return ["cancelled", "no_show"].includes(item.booking?.status);
  }
  confirmPlannedPerformer(item: any) {
    if (item.booking?.collaboratorId && !this.nonPerformed(item))
      item.collaboratorId = item.booking.collaboratorId;
  }
  private requiresActual(item: any) {
    if (item.kind !== "service" || this.nonPerformed(item)) return false;
    const service = this.catalogServices.find(
      (row) => row.id === item.serviceId,
    );
    if (service?.requiresCollaborator === false) return false;
    return (
      !this.sale ||
      !item.id ||
      (this.sale.orderStatus === "open" &&
        item.booking?.status !== "completed") ||
      !!item.originalCollaboratorId
    );
  }
  private requiresChargeReason(item: any): boolean {
    if (!this.nonPerformed(item)) return false;
    const priced = this.quote?.items[this.items.indexOf(item)];
    if (Number(priced?.lineTotal || 0) + Number(priced?.taxTotal || 0) === 0)
      return false;
    const original = this.sale?.items?.find((row: any) => row.id === item.id);
    return !(
      this.sale?.orderStatus === "confirmed" &&
      original &&
      Number(priced?.lineTotal) === Number(original.lineTotal) &&
      Number(priced?.taxTotal) === Number(original.taxTotal) &&
      (item.nonPerformanceChargeReason || "").trim() ===
        (original.nonPerformanceChargeReason || "").trim()
    );
  }
  canSubmit(keepOpen = false): boolean {
    return Boolean(
      this.sale?.orderStatus !== "cancelled" &&
      !this.performedAtError &&
      !this.paymentPending &&
      this.writeState.kind === "empty" &&
      this.quote &&
      !this.quoteBusy &&
      !this.quoteError &&
      this.customerId &&
      this.items.length &&
      this.items.every(
        (item) =>
          item.unitPrice !== "" &&
          Number(item.unitPrice) >= 0 &&
          (keepOpen || !this.requiresActual(item) || !!item.collaboratorId) &&
          (keepOpen ||
            !this.requiresChargeReason(item) ||
            (item.nonPerformanceChargeReason || "").trim().length >= 3),
      ),
    );
  }

  onPaymentsUpdated(result: any): void {
    this.sale = {
      ...this.sale,
      revision: result.revision,
      paymentBasis: result.summary.basis,
      ...(result.summary.status
        ? { paymentStatus: result.summary.status }
        : {}),
    };
  }

  submit(keepOpen = false): void {
    if (!this.online) {
      this.quoteError =
        "Rete assente: verifica la connessione e riprova l'invio.";
      return;
    }
    if (!this.canSubmit(keepOpen)) return;
    this.submitOrder.emit({
      customerId: this.customerId,
      locationId: this.locationId || undefined,
      appointmentId: this.appointmentId || undefined,
      revision: this.sale?.revision,
      orderStatus: keepOpen ? "open" : "confirmed",
      ...(this.sale
        ? {}
        : {
            paymentStatus: keepOpen ? "unpaid" : this.paymentStatus,
            paymentMethod: this.paymentMethod,
          }),
      orderDiscount: String(this.orderDiscount || 0),
      items: this.itemPayload(),
      ...(this.hasNewServices && this.performedAt
        ? { servicesStartAt: new Date(this.performedAt).toISOString() }
        : {}),
    });
  }
}

function toLocalInput(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

