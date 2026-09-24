import { CommonModule } from "@angular/common";
import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnInit,
  Output,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { CustomSelectComponent } from "../custom-select.component";
import { QuickCreateDialogComponent, QuickCreateKind } from "../quick-create-dialog.component";

@Component({
  selector: "barber-quick-order-modal",
  standalone: true,
  imports: [CommonModule, FormsModule, CustomSelectComponent, QuickCreateDialogComponent],
  templateUrl: "./quick-order-modal.component.html",
  styleUrl: "./quick-order-modal.component.css",
})
export class QuickOrderModalComponent implements OnInit {
  protected readonly Number = Number;
  @Input() customers: any[] = [];
  @Input() services: any[] = [];
  @Input() products: any[] = [];
  @Input() collaborators: any[] = [];
  @Input() defaultCollaboratorId = "";
  @Input() appointment: any = null;
  @Input() loading = false;

  @Output() close = new EventEmitter<void>();
  @Output() submitOrder = new EventEmitter<Record<string, unknown>>();
  @Output() catalogChanged = new EventEmitter<void>();

  customerId = "";
  appointmentId = "";
  paymentMethod = "cash";
  items: any[] = [];
  pricePadIndex = -1;
  quickCreateKind: QuickCreateKind | null = null;
  private readonly createdCustomers: any[] = [];
  private readonly createdServices: any[] = [];
  private readonly createdProducts: any[] = [];

  @HostListener("document:keydown.escape")
  closeOnEscape(): void {
    if (!this.loading) this.close.emit();
  }

  ngOnInit(): void {
    if (!this.appointment) {
      return;
    }
    this.appointmentId = this.appointment.id;
    this.customerId =
      this.appointment.customerId || this.appointment.customer?.id || "";
    if (this.appointment.service) {
      this.addService(this.appointment.service);
    }
  }

  get customerOptions() {
    return this.uniqueEntities([...this.createdCustomers, ...this.customers]).map((customer) => ({
      value: customer.id,
      label: `${customer.firstName} ${customer.lastName}`.trim(),
    }));
  }

  get collaboratorOptions() {
    return [...this.collaborators].sort((left, right) => {
      if (left.id === this.defaultCollaboratorId) return -1;
      if (right.id === this.defaultCollaboratorId) return 1;
      return `${left.firstName} ${left.lastName}`.localeCompare(
        `${right.firstName} ${right.lastName}`,
        "it",
      );
    }).map((collaborator) => ({
      value: collaborator.id,
      label: `${collaborator.firstName} ${collaborator.lastName}`.trim() +
        (collaborator.id === this.defaultCollaboratorId ? " · default" : ""),
    }));
  }

  get catalogServices(): any[] { return this.uniqueEntities([...this.createdServices, ...this.services]); }
  get catalogProducts(): any[] { return this.uniqueEntities([...this.createdProducts, ...this.products]); }

  onQuickCreated(event: { kind: QuickCreateKind; entity: any }): void {
    if (event.kind === "customer") {
      this.createdCustomers.unshift(event.entity);
      this.customerId = event.entity.id;
    } else if (event.kind === "service") {
      this.createdServices.unshift(event.entity);
      this.addService(event.entity);
    } else {
      this.createdProducts.unshift(event.entity);
      this.addProduct(event.entity);
    }
    this.quickCreateKind = null;
    this.catalogChanged.emit();
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
    return this.items.reduce(
      (sum, item) =>
        sum + Number(item.quantity || 1) * Number(item.unitPrice || 0),
      0,
    );
  }

  get totalServiceDurationMinutes(): number {
    return this.items.reduce((sum, item) => {
      if (item.kind !== "service") return sum;
      const service =
        this.services.find((entry) => entry.id === item.serviceId) ??
        this.createdServices.find((entry) => entry.id === item.serviceId);
      return sum + Number(service?.durationMinutes || 0) * Number(item.quantity || 1);
    }, 0);
  }

  /**
   * L'ordine viene registrato a consuntivo: l'appuntamento termina adesso e
   * inizia indietro della durata totale dei servizi, cosi il calendario
   * racconta una storia realistica invece di un blocco a orario fisso.
   */
  get appointmentWindowLabel(): string {
    const durationMinutes = this.totalServiceDurationMinutes;
    if (!durationMinutes) return "";

    const endsAt = new Date();
    const startsAt = new Date(endsAt.getTime() - durationMinutes * 60_000);
    const format = (value: Date) =>
      value.toLocaleTimeString("it-IT", {
        hour: "2-digit",
        minute: "2-digit",
      });

    return `${format(startsAt)} – ${format(endsAt)}`;
  }

  get isLinkedToAppointment(): boolean {
    return Boolean(this.appointmentId);
  }

  addService(service: any): void {
    this.items.push({
      kind: "service",
      serviceId: service.id,
      label: service.name,
      quantity: 1,
      unitPrice: Number(service.basePrice || 0),
      collaboratorId:
        this.appointment?.collaboratorId ||
        this.appointment?.collaborator?.id ||
        this.defaultCollaboratorId ||
        this.collaborators[0]?.id ||
        "",
    });
  }

  addProduct(product: any): void {
    const requiresPrice = product.price === null || product.price === undefined;
    this.items.push({
      kind: "product",
      productId: product.id,
      label: product.name,
      quantity: 1,
      unitPrice: requiresPrice ? "" : Number(product.price),
      requiresPrice,
    });
    if (requiresPrice) this.pricePadIndex = this.items.length - 1;
  }

  removeItem(index: number): void {
    this.items.splice(index, 1);
    if (this.pricePadIndex === index) this.pricePadIndex = -1;
    if (this.pricePadIndex > index) this.pricePadIndex -= 1;
  }

  appendPrice(value: string): void {
    const item = this.items[this.pricePadIndex];
    if (!item) return;
    const current = String(item.unitPrice ?? "");
    if (value === "." && current.includes(".")) return;
    item.unitPrice = `${current}${value}`;
  }

  clearPrice(): void {
    const item = this.items[this.pricePadIndex];
    if (item) item.unitPrice = "";
  }

  canSubmit(): boolean {
    return Boolean(
      this.customerId &&
      this.items.length &&
      this.items.every(
        (item) =>
          item.unitPrice !== "" &&
          Number(item.unitPrice) >= 0 &&
          (item.kind !== "service" || Boolean(item.collaboratorId)),
      ),
    );
  }

  submit(): void {
    if (!this.canSubmit()) return;
    this.submitOrder.emit({
      customerId: this.customerId,
      appointmentId: this.appointmentId || undefined,
      paymentStatus: "paid",
      paymentMethod: this.paymentMethod,
      items: this.items.map((item) => ({
        kind: item.kind,
        productId: item.productId,
        serviceId: item.serviceId,
        collaboratorId:
          item.kind === "service" ? item.collaboratorId || undefined : undefined,
        quantity: Number(item.quantity || 1),
        unitPrice: Number(item.unitPrice),
      })),
    });
  }
}
