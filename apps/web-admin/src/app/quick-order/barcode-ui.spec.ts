import { of, throwError, Subject } from "rxjs";
const providers = new Map<unknown, unknown>();
jest.mock("@angular/core", () => ({
  Component: () => (target: unknown) => target,
  Injectable: () => (target: unknown) => target,
  Input: () => () => undefined,
  Output: () => () => undefined,
  HostListener: () => () => undefined,
  HostBinding: () => () => undefined,
  ViewChild: () => () => undefined,
  inject: (token: unknown) => providers.get(token),
  ChangeDetectorRef: class {},
  ElementRef: class {},
  EventEmitter: class {
    emit = jest.fn();
  },
}));
jest.mock("@angular/common", () => ({ CommonModule: {} }));
jest.mock("@angular/common/http", () => ({ HttpClient: class {} }));
jest.mock("@angular/forms", () => ({ FormsModule: {} }));
jest.mock("@angular/router", () => ({ RouterLink: class {} }));
jest.mock("@alora/ui", () => ({
  UiPageComponent: class {},
  UiTabsComponent: class {},
  UiSelectComponent: class {},
  uiOptions: (
    items: any[] | null | undefined,
    value: (item: any) => unknown,
    label: (item: any) => string,
  ) =>
    (items ?? []).map((item) => ({ value: value(item), label: label(item) })),
}));
jest.mock("../shell/admin-page-header.component", () => ({
  AdminPageHeaderComponent: class {},
}));
jest.mock("../calendar-input.component", () => ({
  CalendarInputComponent: class {},
}));
jest.mock("../core/admin-api.service", () => ({ AdminApiService: class {} }));
jest.mock("../core/operational-context.service", () => ({
  OperationalContextService: class {},
}));
jest.mock("../core/session.store", () => ({ SessionStore: class {} }));
jest.mock("../core/create-recovery.service", () => ({
  CreateRecoveryService: class {},
}));
jest.mock("../shared/account-payments.component", () => ({
  AccountPaymentsComponent: class {},
}));
jest.mock("../shared/sector-picker.component", () => ({
  SectorPickerComponent: class {},
}));
jest.mock("../shared/function-access.directive", () => ({
  FunctionAccessDirective: class {},
}));
jest.mock("../shared/autofocus-first.directive", () => ({
  AutofocusFirstDirective: class {},
}));
jest.mock("../custom-select.component", () => ({
  CustomSelectComponent: class {},
}));
import { ChangeDetectorRef } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { AdminApiService } from "../core/admin-api.service";
import { OperationalContextService } from "../core/operational-context.service";
import { SessionStore } from "../core/session.store";
import { CreateRecoveryService } from "../core/create-recovery.service";
import { BarcodeScannerService } from "../core/barcode-scanner.service";
import { QuickOrderModalComponent } from "./quick-order-modal.component";
import { InventoryComponent } from "../pages/inventory.component";
import { QuickCreateDialogComponent } from "../quick-create-dialog.component";

describe("barcode UI workflows", () => {
  let modal: QuickOrderModalComponent;
  let inventory: InventoryComponent;
  let dialog: QuickCreateDialogComponent;
  let allowed: boolean;
  const product = {
    id: "product-1",
    name: "Shampoo",
    price: 12,
    isActive: true,
  };
  const api = {
    findProductByBarcode: jest.fn(),
    createOrUpdateProduct: jest.fn(),
    createOrUpdateCustomer: jest.fn(),
    createOrUpdateService: jest.fn(),
  };
  const state = jest.fn();
  const detector = { detectChanges: jest.fn() };
  const http = { post: jest.fn(), get: jest.fn() };
  const scanOrder = (barcode = "12345") =>
    (modal as any).handleScannedBarcode(barcode) as Promise<void>;
  const scanInventory = () =>
    (inventory as any).handleScannedBarcode("12345") as Promise<void>;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    allowed = true;
    providers.set(AdminApiService, api);
    providers.set(SessionStore, { can: () => allowed });
    providers.set(OperationalContextService, {
      selected: { locationId: "site-a" },
      sectors: [],
      locations: () => [],
    });
    providers.set(CreateRecoveryService, { state });
    state.mockReturnValue({ kind: "empty" });
    providers.set(BarcodeScannerService, {
      setOptions: jest.fn(),
      attach: jest.fn(() => jest.fn()),
    });
    providers.set(HttpClient, http);
    providers.set(ChangeDetectorRef, detector);
    api.findProductByBarcode.mockReturnValue(of(product));
    modal = new QuickOrderModalComponent();
    modal.locationId = "site-a";
    jest.spyOn(modal, "queueQuote").mockImplementation(() => undefined);
    inventory = new InventoryComponent();
    inventory.locationId = "site-a";
    inventory.rows = [{ ...product, initialized: true }];
    jest.spyOn(inventory, "loadMovements").mockResolvedValue(undefined);
    dialog = new QuickCreateDialogComponent();
    dialog.kind = "product";
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });
  it.each(["cash", "card", "bank", "other"])(
    "preserves touch checkout with %s payment after a scan",
    async (paymentMethod) => {
      modal.customerId = "customer-1";
      modal.paymentMethod = paymentMethod;
      modal.paymentStatus = "unpaid";
      modal.online = true;
      modal.addService({ id: "service-1", name: "Taglio", basePrice: 20 });
      modal.items[0].collaboratorId = "staff-1";
      await scanOrder();
      await scanOrder();
      modal.items[1].discount = 1;
      modal.orderDiscount = "2";
      modal.quote = { total: 41 };
      modal.submit();
      expect(modal.submitOrder.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: "customer-1",
          locationId: "site-a",
          orderStatus: "confirmed",
          paymentMethod,
          paymentStatus: "unpaid",
          orderDiscount: "2",
          items: expect.arrayContaining([
            expect.objectContaining({
              serviceId: "service-1",
              collaboratorId: "staff-1",
              quantity: 1,
              unitPrice: "20",
            }),
            expect.objectContaining({
              productId: product.id,
              quantity: 2,
              discount: "1",
            }),
          ]),
        }),
      );
    },
  );
  it("retains the inventory command and idempotency key after an uncertain result", async () => {
    await scanInventory();
    inventory.form.quantity = "3";
    inventory.form.reason = "Conteggio";
    http.post.mockReturnValue(throwError(() => ({ status: 0 })));
    await inventory.submit();
    const original = { ...http.post.mock.calls[0][1] };
    inventory.form.quantity = "99";
    await inventory.submit();
    expect(http.post.mock.calls[1][1]).toEqual(original);
    expect(original).toEqual(
      expect.objectContaining({
        quantity: "3",
        productId: product.id,
        locationId: "site-a",
        idempotencyKey: expect.any(String),
      }),
    );
    expect(inventory.attempted).toBe(true);
  });
  it("preserves manual inventory selection and paginated movement loading", async () => {
    await inventory.selectProduct(product.id);
    expect(inventory.form.kind).toBe("receipt");
    await inventory.loadMore();
    expect(inventory.loadMovements).toHaveBeenLastCalledWith(true);
  });
  it("increments a scanned row and recalculates its quote", async () => {
    await scanOrder();
    await scanOrder();
    expect(modal.items).toHaveLength(1);
    expect(modal.items[0].quantity).toBe(2);
    expect(modal.queueQuote).toHaveBeenCalledTimes(2);
    expect(modal.scanFeedback).toContain("Shampoo");
  });
  it("reorders lines and sends them in the new order", () => {
    modal.addService({ id: "service-1", name: "Taglio", basePrice: 20 });
    modal.addProduct({ ...product, price: 10 });
    modal.moveItem(1, 0);
    expect(modal.items.map((row) => row.label)).toEqual(["Shampoo", "Taglio"]);
    modal.moveItem(0, 5);
    expect(modal.items[0].label).toBe("Shampoo");
    modal.customerId = "customer-1";
    modal.online = true;
    modal.items[1].collaboratorId = "staff-1";
    modal.quote = { total: 30 };
    modal.submit();
    const sent = (modal.submitOrder.emit as jest.Mock).mock.calls[0][0].items;
    expect(sent.map((row: any) => row.kind)).toEqual(["product", "service"]);
    // VAT and price mode are never chosen at the till.
    expect(sent[0]).not.toHaveProperty("vatRate");
    expect(sent[0]).not.toHaveProperty("priceMode");
  });
  it("asks why only when a list price with defined VAT changes", () => {
    modal.addService({
      id: "service-1",
      name: "Taglio",
      basePrice: 20,
      priceMode: "gross",
      vatRate: 22,
    });
    modal.addService({ id: "service-2", name: "Barba", basePrice: 10 });
    expect(modal.priceReasonRequired(modal.items[0])).toBe(false);
    modal.items[0].unitPrice = 18;
    modal.items[1].unitPrice = 8;
    expect(modal.priceReasonRequired(modal.items[0])).toBe(true);
    // Historical lines without VAT: the server asks nothing.
    expect(modal.priceReasonRequired(modal.items[1])).toBe(false);
    modal.customerId = "customer-1";
    modal.items.forEach((row) => (row.collaboratorId = "staff-1"));
    modal.quote = { total: 26 };
    expect(modal.canSubmit()).toBe(false);
    modal.items[0].priceOverrideReason = "Promo";
    expect(modal.canSubmit()).toBe(true);
  });
  it("preserves manually entered rows and prices", async () => {
    modal.addProduct({ ...product, price: null });
    expect(modal.pricePadIndex).toBe(0);
    expect(modal.items[0].unitPrice).toBe("");
    modal.items[0].unitPrice = 17;
    await scanOrder();
    expect(modal.items[0].unitPrice).toBe(17);
    expect(modal.items[0].quantity).toBe(2);
  });
  it("opens a prefilled create/associate dialog on HTTP 404 and waits for resolution", async () => {
    api.findProductByBarcode.mockReturnValue(
      throwError(() => ({ status: 404 })),
    );
    const pending = scanOrder("0012345");
    await Promise.resolve();
    expect(modal.quickCreateKind).toBe("product");
    expect(modal.quickCreatePrefill).toEqual({ barcode: "0012345" });
    modal.onQuickCreated({
      kind: "product",
      entity: { ...product, barcode: "0012345" },
    });
    await pending;
    expect(modal.items[0].productId).toBe(product.id);
    expect(modal.catalogChanged.emit).toHaveBeenCalled();
    expect(modal.quickCreatePrefill).toEqual({});
  });
  it("increments an existing cart product when its missing barcode is associated", async () => {
    modal.addProduct(product);
    api.findProductByBarcode.mockReturnValue(
      throwError(() => ({ status: 404 })),
    );
    const pending = scanOrder("0012345");
    await Promise.resolve();
    modal.onQuickCreated({
      kind: "product",
      entity: { ...product, barcode: "0012345" },
    });
    await pending;
    expect(modal.items).toHaveLength(1);
    expect(modal.items[0].quantity).toBe(2);
  });
  it("does not open unknown recovery when a write begins during lookup", async () => {
    const lookup = new Subject<any>();
    api.findProductByBarcode.mockReturnValue(lookup);
    const pending = scanOrder();
    state.mockReturnValue({ kind: "pending" });
    lookup.error({ status: 404 });
    await pending;
    expect(modal.quickCreateKind).toBeNull();
    expect(modal.items).toEqual([]);
  });
  it("allows cancelling unknown recovery without changing the order", async () => {
    api.findProductByBarcode.mockReturnValue(of(null));
    const pending = scanOrder();
    await Promise.resolve();
    modal.cancelQuickCreate();
    await pending;
    expect(modal.items).toEqual([]);
    expect(modal.quickCreateKind).toBeNull();
  });
  it("does not offer creation to a user without product management access", async () => {
    allowed = false;
    api.findProductByBarcode.mockReturnValue(
      throwError(() => ({ status: 404 })),
    );
    await scanOrder();
    expect(modal.quickCreateKind).toBeNull();
    expect(modal.scanFeedback).toContain("gestisce il listino");
  });
  it("reports an offline lookup without opening creation or changing rows", async () => {
    api.findProductByBarcode.mockReturnValue(throwError(() => ({ status: 0 })));
    await scanOrder();
    expect(modal.scanFeedback).toContain("Rete assente");
    expect(modal.items).toEqual([]);
    expect(modal.quickCreateKind).toBeNull();
  });
  it("blocks scans for cancelled orders, pending writes and active dialogs", async () => {
    modal.sale = { orderStatus: "cancelled" };
    await scanOrder();
    modal.sale = null;
    state.mockReturnValue({ kind: "pending" });
    await scanOrder();
    state.mockReturnValue({ kind: "empty" });
    modal.quickCreateKind = "customer";
    await scanOrder();
    expect(api.findProductByBarcode).not.toHaveBeenCalled();
  });
  it("ignores a lookup completing after the location changes or modal closes", async () => {
    const lookup = new Subject<any>();
    api.findProductByBarcode.mockReturnValue(lookup);
    const pending = scanOrder();
    modal.locationId = "site-b";
    lookup.next(product);
    await pending;
    expect(modal.items).toEqual([]);
    const second = new Subject<any>();
    api.findProductByBarcode.mockReturnValue(second);
    const later = scanOrder();
    modal.ngOnDestroy();
    second.next(product);
    await later;
    expect(modal.items).toEqual([]);
  });
  it("selects the stock row, loads movements and focuses quantity", async () => {
    const focus = jest.fn();
    (inventory as any).movementQuantity = { nativeElement: { focus } };
    await scanInventory();
    expect(inventory.productId).toBe(product.id);
    expect(inventory.form.kind).toBe("receipt");
    expect(inventory.loadMovements).toHaveBeenCalled();
    expect(detector.detectChanges).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
  });
  it("preserves inventory during a pending operation or unavailable product", async () => {
    inventory.attempted = true;
    await scanInventory();
    expect(api.findProductByBarcode).not.toHaveBeenCalled();
    inventory.attempted = false;
    inventory.rows = [];
    await scanInventory();
    expect(inventory.productId).toBe("");
    expect(inventory.scanFeedback).toContain("non disponibile");
  });
  it.each([404, 0])(
    "reports inventory lookup %s without selecting a product",
    async (status) => {
      api.findProductByBarcode.mockReturnValue(throwError(() => ({ status })));
      await scanInventory();
      expect(inventory.productId).toBe("");
      expect(inventory.scanFeedback).toContain(
        status === 404 ? "non trovato" : "Rete assente",
      );
    },
  );
  it("creates a product with the scanned barcode", async () => {
    dialog.prefill = { barcode: "0012345" };
    dialog.name = "Shampoo";
    dialog.price = 12;
    api.createOrUpdateProduct.mockReturnValue(of(product));
    await dialog.save();
    expect(api.createOrUpdateProduct).toHaveBeenCalledWith("", {
      name: "Shampoo",
      price: 12,
      barcode: "0012345",
    });
    expect(dialog.created.emit).toHaveBeenCalledWith({
      kind: "product",
      entity: product,
    });
  });
  it("associates an existing product without requiring or rewriting its name and price", async () => {
    dialog.prefill = { barcode: "0012345" };
    dialog.existingProductId = product.id;
    api.createOrUpdateProduct.mockReturnValue(of(product));
    await dialog.save();
    expect(api.createOrUpdateProduct).toHaveBeenCalledWith(product.id, {
      barcode: "0012345",
    });
  });
  it.each([409, 0])(
    "retains dialog data and gives actionable feedback on save %s",
    async (status) => {
      dialog.prefill = { barcode: "0012345" };
      dialog.name = "Shampoo";
      dialog.price = 12;
      api.createOrUpdateProduct.mockReturnValue(throwError(() => ({ status })));
      await dialog.save();
      expect(dialog.error).toContain(
        status === 409 ? "già associato" : "Rete assente",
      );
      expect(dialog.barcode).toBe("0012345");
      expect(dialog.created.emit).not.toHaveBeenCalled();
      expect(dialog.saving).toBe(false);
    },
  );
});
