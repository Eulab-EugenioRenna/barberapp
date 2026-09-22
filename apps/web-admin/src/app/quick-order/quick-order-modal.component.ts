import { CommonModule } from "@angular/common";
import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { CustomSelectComponent } from "../custom-select.component";

@Component({
  selector: "barber-quick-order-modal",
  standalone: true,
  imports: [CommonModule, FormsModule, CustomSelectComponent],
  templateUrl: "./quick-order-modal.component.html",
  styleUrl: "./quick-order-modal.component.css",
})
export class QuickOrderModalComponent {
  protected readonly Number = Number;
  @Input() customers: any[] = [];
  @Input() stations: any[] = [];
  @Input() services: any[] = [];
  @Input() products: any[] = [];
  @Input() loading = false;

  @Output() close = new EventEmitter<void>();
  @Output() submitOrder = new EventEmitter<Record<string, unknown>>();

  customerId = "";
  paymentMethod = "cash";
  items: any[] = [];
  pricePadIndex = -1;

  @HostListener("document:keydown.escape")
  closeOnEscape(): void {
    if (!this.loading) this.close.emit();
  }

  get customerOptions() {
    return this.customers.map((customer) => ({
      value: customer.id,
      label: `${customer.firstName} ${customer.lastName}`.trim(),
    }));
  }

  get total(): number {
    return this.items.reduce(
      (sum, item) =>
        sum + Number(item.quantity || 1) * Number(item.unitPrice || 0),
      0,
    );
  }

  addService(service: any): void {
    this.items.push({
      kind: "service",
      serviceId: service.id,
      label: service.name,
      quantity: 1,
      unitPrice: Number(service.basePrice || 0),
      stationIds: [],
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
      stationIds: [],
      requiresPrice,
    });
    if (requiresPrice) this.pricePadIndex = this.items.length - 1;
  }

  removeItem(index: number): void {
    this.items.splice(index, 1);
    if (this.pricePadIndex === index) this.pricePadIndex = -1;
    if (this.pricePadIndex > index) this.pricePadIndex -= 1;
  }

  toggleStation(item: any, stationId: string): void {
    const selected = new Set(item.stationIds || []);
    if (selected.has(stationId)) {
      selected.delete(stationId);
    } else {
      selected.add(stationId);
    }
    item.stationIds = [...selected];
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
        (item) => item.unitPrice !== "" && Number(item.unitPrice) >= 0,
      ),
    );
  }

  submit(): void {
    if (!this.canSubmit()) return;
    this.submitOrder.emit({
      customerId: this.customerId,
      paymentStatus: "paid",
      paymentMethod: this.paymentMethod,
      items: this.items.map((item) => ({
        kind: item.kind,
        productId: item.productId,
        serviceId: item.serviceId,
        quantity: Number(item.quantity || 1),
        unitPrice: Number(item.unitPrice),
        stationIds: item.stationIds || [],
      })),
    });
  }
}
