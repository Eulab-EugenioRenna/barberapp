import { CommonModule } from "@angular/common";
import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  Output,
  inject,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { UiSelectComponent } from "@alora/ui";
import { CalendarInputComponent } from "../calendar-input.component";
import { CustomerSelectComponent } from "../shared/customer-select.component";
import { AppointmentContactComponent } from "../shared/appointment-contact.component";
import {
  QuickCreateDialogComponent,
  QuickCreateKind,
} from "../quick-create-dialog.component";
import { SessionStore } from "../core/session.store";
import { AmountsPrivacyService } from "../core/amounts-privacy.service";
import { humanError } from "../core/human-error";
import { appointmentStatusLabel } from "../shared/presentation-copy";
import { toLocalDateKey } from "@barber/shared/utils";
import { AppointmentsFacade } from "./appointments.facade";
import { AppointmentsService } from "./appointments.service";
import { localBookingTime } from "./booking-local-time";
import {
  BUSY_WARNING,
  DEFAULT_CANCEL_REASON,
  STOPPED_STATUSES,
  TIME_PATTERN,
  applySequence,
  buildCreate,
  followsPrevious,
  missingForSave,
  overlapsBusy,
  planEdit,
  rowDuration,
  rowInstant,
  splitLocal,
  type BusyRow,
  type EditorRow,
  type SaveOp,
} from "./appointment-editor.logic";

type Slot = { time: string; label: string; outsideHours: boolean };
type SlotEntry = { loading: boolean; slots: Slot[]; failed: boolean };

const CREATE_STATUSES = ["confirmed", "requested"];
const EDIT_STATUSES = [
  "confirmed",
  "checked_in",
  "completed",
  "no_show",
  "cancelled",
];

/**
 * The one booking editor of the agenda, for new and existing bookings:
 * 1 · Cliente, 2 · Servizi (with times), 3 · Stato e note, one «Salva».
 * Same sheet as the till: two columns, dark bar at the bottom.
 */
@Component({
  selector: "barber-admin-appointments-editor-modal",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    UiSelectComponent,
    CalendarInputComponent,
    CustomerSelectComponent,
    QuickCreateDialogComponent,
    AppointmentContactComponent,
  ],
  templateUrl: "./admin-appointments-editor-modal.component.html",
  styleUrl: "./admin-appointments-editor-modal.component.css",
})
export class AdminAppointmentsEditorModalComponent implements OnInit, OnDestroy {
  readonly facade = inject(AppointmentsFacade);
  readonly session = inject(SessionStore);
  private readonly bookings = inject(AppointmentsService);
  private readonly privacy = inject(AmountsPrivacyService);

  /** The appointment to open (only its id is needed); null for a new one. */
  @Input() appointment: any = null;
  @Output() close = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();
  @Output() createOrder = new EventEmitter<any>();

  loading = false;
  loadFailed = false;
  saving = false;
  feedback = "";

  anchorId = "";
  private anchor: any = null;
  private account: any = null;
  locationId = "";
  day = toLocalDateKey(new Date());

  customerId = "";
  private originalCustomerId = "";
  customerExtra: { id: string; firstName?: string; lastName?: string } | null =
    null;

  rows: EditorRow[] = [];
  private removed: EditorRow[] = [];
  history: any[] = [];

  status = "confirmed";
  private originalStatus = "";
  private statusTouched = false;
  reason = DEFAULT_CANCEL_REASON;
  notes = "";
  private originalNotes = "";
  whatsAppConsent = false;

  quickCreateKind: QuickCreateKind | null = null;

  private readonly slotCache = new Map<string, SlotEntry>();
  private slotTimer: ReturnType<typeof setTimeout> | null = null;
  private keySeq = 0;
  private revisionKey: { key: string; payload: string } | null = null;

  get isEdit(): boolean {
    return !!this.anchorId;
  }

  async ngOnInit(): Promise<void> {
    if (!this.facade.services().length) {
      try {
        await this.facade.loadViewData();
      } catch {
        // The facade keeps the load error; the editor still opens.
      }
    }
    if (this.appointment?.id) await this.loadExisting(this.appointment.id);
    else this.locationId = this.facade.defaultLocationId();
  }

  ngOnDestroy(): void {
    if (this.slotTimer) clearTimeout(this.slotTimer);
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    if (!this.saving && !this.quickCreateKind) this.close.emit();
  }

  // ---------- loading ----------

  /** Any booking, also outside the agenda window: read by id from the server. */
  async loadExisting(id: string): Promise<void> {
    // Edit mode from the first moment: a failed read never turns into a new booking.
    this.anchorId = id;
    this.loading = true;
    this.loadFailed = false;
    this.feedback = "";
    try {
      const known =
        this.facade.appointments().find((row) => row.id === id) ||
        (this.appointment?.customer ? this.appointment : null);
      const [account, detail] = await Promise.all([
        this.bookings.loadBooking(id).catch(() => null),
        known ? Promise.resolve(known) : this.bookings.loadAppointment(id),
      ]);
      this.apply(id, account, detail);
    } catch (error) {
      this.loadFailed = true;
      this.feedback = humanError(
        error,
        "Non riusciamo ad aprire la prenotazione: riprova",
      );
    } finally {
      this.loading = false;
    }
  }

  private apply(id: string, account: any, detail: any): void {
    this.anchorId = id;
    this.anchor = detail;
    this.account = account;
    const list: any[] = account?.appointments?.length
      ? account.appointments
      : [detail];
    const opened = list.find((row) => row.id === id) || detail;
    const shown = list.filter(
      (row) => row.id === id || !STOPPED_STATUSES.includes(row.status),
    );
    this.history = list.filter((row) => !shown.includes(row));
    this.rows = shown.map((row, index) => this.toRow(row, shown[index - 1]));
    this.removed = [];
    this.day = this.rows[0]?.date || this.day;
    this.locationId =
      opened?.locationId ||
      detail?.locationId ||
      this.facade.defaultLocationId();
    this.customerId =
      account?.customerId || detail?.customerId || detail?.customer?.id || "";
    this.originalCustomerId = this.customerId;
    const customer = account?.customer || detail?.customer;
    this.customerExtra = this.customerId
      ? { id: this.customerId, ...(customer || {}) }
      : null;
    this.notes = detail?.customerNotes || "";
    this.originalNotes = this.notes;
    this.status = opened?.status || "confirmed";
    this.originalStatus = this.status;
    this.statusTouched = false;
    this.reason = DEFAULT_CANCEL_REASON;
    this.scheduleSlots();
  }

  private toRow(row: any, previous: any): EditorRow {
    const { date, time } = splitLocal(row.startsAt);
    const serviceId = row.service?.id || row.serviceId;
    const collaboratorId = row.collaboratorId || "";
    return {
      key: row.id,
      appointmentId: row.id,
      orderItemId: row.orderItemId || undefined,
      serviceId,
      collaboratorId,
      date,
      time,
      follow: followsPrevious(previous, row),
      status: row.status,
      held: {
        serviceId,
        collaboratorId,
        startsAt: new Date(row.startsAt).toISOString(),
        local: localBookingTime(row.startsAt),
        durationMinutes: Math.max(
          1,
          Math.round(
            (Date.parse(row.endsAt) - Date.parse(row.startsAt)) / 60000,
          ) || 30,
        ),
      },
    };
  }

  // ---------- catalog ----------

  get catalog(): any[] {
    return this.facade.servicesAt(this.locationId);
  }

  service(id: string): any {
    return (
      this.facade.services().find((row) => row.id === id) ||
      [this.anchor, ...(this.account?.appointments || [])].find(
        (row) => (row?.service?.id || row?.serviceId) === id,
      )?.service ||
      null
    );
  }

  serviceName(id: string): string {
    return this.service(id)?.name || "Servizio";
  }

  serviceOptions(row: EditorRow) {
    const options = this.catalog.map((service) => ({
      value: service.id,
      label: `${service.name} · ${service.durationMinutes} min`,
    }));
    if (!options.some((option) => option.value === row.serviceId))
      options.unshift({ value: row.serviceId, label: this.serviceName(row.serviceId) });
    return options;
  }

  peopleOptions(row: EditorRow) {
    const options = this.facade.professionalOptionsFor(
      row.serviceId,
      this.locationId,
    );
    if (
      row.collaboratorId &&
      !options.some((option) => option.value === row.collaboratorId)
    ) {
      const person = this.facade
        .collaborators()
        .find((item) => item.id === row.collaboratorId);
      options.push({
        value: row.collaboratorId,
        label: person
          ? `${person.firstName} ${person.lastName}`
          : "Professionista assegnato",
      });
    }
    return options;
  }

  private minutes = (serviceId: string): number | undefined =>
    this.facade.services().find((row) => row.id === serviceId)
      ?.durationMinutes;

  duration(row: EditorRow): number {
    return rowDuration(row, this.minutes);
  }

  picked(serviceId: string): boolean {
    return this.rows.some((row) => row.serviceId === serviceId);
  }

  get customerChanged(): boolean {
    return (
      this.isEdit && !!this.customerId && this.customerId !== this.originalCustomerId
    );
  }

  get showLocation(): boolean {
    return !this.isEdit && this.facade.bookingLocationOptions().length > 1;
  }

  setLocation(locationId: string): void {
    this.locationId = locationId;
    const offered = new Set(this.catalog.map((row) => row.id));
    this.rows = this.rows.filter((row) => offered.has(row.serviceId));
    this.recompute();
  }

  // ---------- rows ----------

  addService(serviceId: string): void {
    if (!serviceId || this.rows.length >= 20) return;
    const previous = this.rows.at(-1);
    const candidate: EditorRow = {
      key: `new-${++this.keySeq}`,
      serviceId,
      collaboratorId: "",
      date: previous?.date || this.day,
      time: "",
      follow: !!previous,
      status: "",
    };
    const keep = previous?.collaboratorId;
    if (
      keep &&
      this.peopleOptions(candidate).some((option) => option.value === keep)
    )
      candidate.collaboratorId = keep;
    this.rows = [...this.rows, candidate];
    this.recompute();
  }

  removeRow(row: EditorRow): void {
    if (this.isEdit && this.rows.length <= 1) return;
    if (row.appointmentId) this.removed = [...this.removed, row];
    this.rows = this.rows.filter((item) => item !== row);
    this.recompute();
  }

  canRemove(row: EditorRow): boolean {
    return !this.isEdit || this.rows.length > 1 || !row.appointmentId;
  }

  setService(row: EditorRow, serviceId: string): void {
    row.serviceId = serviceId;
    if (
      row.collaboratorId &&
      !this.peopleOptions(row).some((o) => o.value === row.collaboratorId)
    )
      row.collaboratorId = "";
    this.recompute();
  }

  setCollaborator(row: EditorRow, collaboratorId: string): void {
    row.collaboratorId = collaboratorId;
    this.recompute();
  }

  setDay(day: string): void {
    if (!day) return;
    this.day = day;
    this.rows = this.rows.map((row) => ({ ...row, date: day }));
    this.recompute();
  }

  pickTime(row: EditorRow, time: string): void {
    if (!TIME_PATTERN.test(time)) return;
    row.time = time;
    if (this.rows.indexOf(row) > 0) row.follow = false;
    this.recompute();
  }

  followAgain(row: EditorRow): void {
    row.follow = true;
    this.recompute();
  }

  private recompute(): void {
    this.rows = applySequence(this.rows, this.minutes);
    this.feedback = "";
    this.scheduleSlots();
  }

  trackRow(_index: number, row: EditorRow): string {
    return row.key;
  }

  // ---------- suggested times (automatic, never blocking) ----------

  private slotKey(row: EditorRow): string {
    return [row.appointmentId || "", row.serviceId, row.collaboratorId, row.date].join("|");
  }

  private scheduleSlots(): void {
    if (this.slotTimer) clearTimeout(this.slotTimer);
    this.slotTimer = setTimeout(() => {
      this.slotTimer = null;
      void this.loadSlots();
    }, 300);
  }

  private async loadSlots(): Promise<void> {
    await Promise.all(
      this.rows.map(async (row) => {
        const key = this.slotKey(row);
        if (!row.serviceId || !row.date || this.slotCache.has(key)) return;
        const entry: SlotEntry = { loading: true, slots: [], failed: false };
        this.slotCache.set(key, entry);
        try {
          const response = await this.bookings.slots({
            appointmentId: row.appointmentId,
            date: row.date,
            locationId: this.locationId,
            line: {
              serviceId: row.serviceId,
              ...(row.collaboratorId ? { collaboratorId: row.collaboratorId } : {}),
            },
          });
          entry.slots = (response?.slots || []).map((slot: any) => ({
            time: splitLocal(slot.startsAt).time,
            label: slot.label || splitLocal(slot.startsAt).time,
            outsideHours: !!slot.outsideHours,
          }));
        } catch {
          entry.failed = true;
          // Forget it: the next change asks again.
          setTimeout(() => this.slotCache.delete(key), 0);
        } finally {
          entry.loading = false;
        }
      }),
    );
  }

  slotsFor(row: EditorRow): SlotEntry | undefined {
    return this.slotCache.get(this.slotKey(row));
  }

  /** Inline, non-blocking: the server has the last word when saving. */
  warnings(row: EditorRow): string[] {
    const out: string[] = [];
    if (!TIME_PATTERN.test(row.time)) return out;
    const entry = this.slotsFor(row);
    const slot = entry?.slots.find((item) => item.time === row.time);
    if (overlapsBusy(row, this.duration(row), this.busyAround(row)))
      out.push(BUSY_WARNING);
    else if (
      entry &&
      !entry.loading &&
      !entry.failed &&
      !slot &&
      !(row.follow && this.rows.indexOf(row) > 0) &&
      rowInstant(row) !== row.held?.startsAt
    )
      out.push(
        "Orario scritto a mano: al salvataggio si controlla solo che il professionista sia libero.",
      );
    if (slot?.outsideHours)
      out.push("Fuori dall'orario di apertura o di lavoro: si può prenotare lo stesso.");
    return out;
  }

  private busyAround(row: EditorRow): BusyRow[] {
    const own = new Set(
      [...this.rows, ...this.removed, ...this.history].map(
        (item: any) => item.appointmentId || item.id,
      ),
    );
    const agenda: BusyRow[] = this.facade
      .appointments()
      .filter((item) => !own.has(item.id))
      .map((item) => ({
        id: item.id,
        collaboratorId: item.collaboratorId,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        status: item.status,
      }));
    const siblings: BusyRow[] = this.rows
      .filter((item) => item !== row && rowInstant(item))
      .map((item) => {
        const start = rowInstant(item)!;
        return {
          id: `sibling:${item.key}`,
          collaboratorId: item.collaboratorId,
          startsAt: start,
          endsAt: new Date(
            Date.parse(start) + this.duration(item) * 60000,
          ).toISOString(),
        };
      });
    return [...agenda, ...siblings];
  }

  // ---------- status and notes ----------

  get statusOptions(): Array<{ value: string; label: string }> {
    const list = this.isEdit ? [...EDIT_STATUSES] : [...CREATE_STATUSES];
    if (this.originalStatus && !list.includes(this.originalStatus))
      list.unshift(this.originalStatus);
    return list.map((value) => ({ value, label: appointmentStatusLabel(value) }));
  }

  setStatus(status: string): void {
    this.status = status;
    this.statusTouched = true;
    this.feedback = "";
  }

  get askReason(): boolean {
    return (
      this.isEdit && this.status === "cancelled" && this.originalStatus !== "cancelled"
    );
  }

  // ---------- summary ----------

  get canSeeAmounts(): boolean {
    return this.session.can("sales.read") && !this.privacy.hidden();
  }

  get total(): number {
    return this.rows.reduce((sum, row) => {
      const booked = this.account?.appointments?.find(
        (item: any) => item.id === row.appointmentId,
      );
      if (booked && row.held?.serviceId === row.serviceId && booked.estimatedPrice != null)
        return sum + Number(booked.estimatedPrice || 0);
      return sum + Number(this.service(row.serviceId)?.basePrice || 0);
    }, 0);
  }

  get totalMinutes(): number {
    return this.rows.reduce((sum, row) => sum + this.duration(row), 0);
  }

  get missing(): string {
    return missingForSave({ customerId: this.customerId, rows: this.rows });
  }

  get accountLabel(): string {
    const status = this.account?.orderStatus ?? this.anchor?.orderItem?.sale?.orderStatus;
    return status === "open" ? "Chiudi il conto" : "Apri il conto";
  }

  get canCancel(): boolean {
    return this.isEdit && this.originalStatus !== "cancelled";
  }

  get pendingCreation(): boolean {
    return !this.isEdit && this.facade.creations.state("appointment").kind !== "empty";
  }

  get pendingUpdate(): boolean {
    return this.facade.appointmentUpdateState().kind !== "empty";
  }

  get blocked(): boolean {
    return (
      this.loading ||
      this.loadFailed ||
      this.saving ||
      this.pendingCreation ||
      this.pendingUpdate
    );
  }

  get title(): string {
    if (!this.isEdit) return "Nuovo appuntamento";
    const name = [this.customerExtra?.firstName, this.customerExtra?.lastName]
      .filter(Boolean)
      .join(" ");
    return name || "Appuntamento";
  }

  get subtitle(): string {
    if (!this.isEdit)
      return "Cliente, servizio e ora: il resto si può sistemare dopo.";
    const first = this.rows[0];
    if (!first) return "";
    const when = new Date(`${first.date}T00:00`).toLocaleDateString("it-IT", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    return `${when} · ${first.time} · ${this.rows.map((row) => this.serviceName(row.serviceId)).join(" + ")}`;
  }

  // ---------- actions ----------

  private plan(): SaveOp[] {
    return planEdit({
      anchorId: this.anchorId,
      rows: this.rows,
      removed: this.removed,
      status: this.status,
      statusTouched: this.statusTouched,
      reason: this.reason,
      customerId: this.customerId,
      originalCustomerId: this.originalCustomerId,
      notes: this.notes,
      originalNotes: this.originalNotes,
      revision: Number.isInteger(this.account?.revision)
        ? this.account.revision
        : (this.anchor?.orderItem?.sale?.revision ?? null),
    });
  }

  /** The same revision is retried with the same key: never two copies. */
  private keyFor(body: Record<string, unknown>): string {
    const payload = JSON.stringify(body);
    if (this.revisionKey?.payload !== payload)
      this.revisionKey = { key: `agenda-${crypto.randomUUID()}`, payload };
    return this.revisionKey.key;
  }

  private async persist(): Promise<boolean> {
    const missing = this.missing;
    if (missing) {
      this.feedback = missing;
      return false;
    }
    this.saving = true;
    this.feedback = "";
    let done = 0;
    try {
      if (!this.isEdit) {
        await this.bookings.create(
          buildCreate({
            customerId: this.customerId,
            rows: this.rows,
            status: this.status,
            notes: this.notes,
            locationId: this.locationId,
            whatsAppConsent: this.whatsAppConsent,
          }),
        );
        done++;
      } else {
        for (const op of this.plan()) {
          if (op.kind === "revise")
            await this.bookings.reviseBooking(op.appointmentId, {
              idempotencyKey: this.keyFor(op.body),
              ...op.body,
            });
          else await this.bookings.patch(op.appointmentId, op.body);
          done++;
        }
        this.revisionKey = null;
      }
      try {
        await this.facade.loadViewData();
      } catch {
        // The agenda shows its own load error.
      }
      this.saved.emit();
      return true;
    } catch (error) {
      const message = humanError(error, "Salvataggio non riuscito: riprova");
      if (done > 0 && this.isEdit) {
        await this.loadExisting(this.anchorId);
        this.saved.emit();
        this.feedback = `${message}. Una parte delle modifiche è già salvata: controlla e riprova.`;
      } else this.feedback = message;
      return false;
    } finally {
      this.saving = false;
    }
  }

  async save(): Promise<void> {
    if (this.blocked) return;
    const completedNow =
      this.isEdit && this.status === "completed" && this.originalStatus !== "completed";
    const order = this.orderAppointment();
    if (!(await this.persist())) return;
    // A service just done is closed with a sale: the till opens at once.
    if (completedNow && this.session.can("sales.manage")) this.createOrder.emit(order);
    this.close.emit();
  }

  /** «Annulla appuntamento»: one tap, it can be reactivated from the same editor. */
  async cancelAppointment(): Promise<void> {
    if (this.blocked || !this.canCancel) return;
    this.setStatus("cancelled");
    await this.save();
  }

  async openAccount(): Promise<void> {
    if (this.blocked) return;
    const order = this.orderAppointment();
    if (this.plan().length && !(await this.persist())) return;
    this.createOrder.emit(order);
    this.close.emit();
  }

  private orderAppointment(): any {
    const fromAgenda = this.facade
      .appointments()
      .find((row) => row.id === this.anchorId);
    if (fromAgenda) return fromAgenda;
    const row = this.rows[0];
    return {
      ...(this.anchor || {}),
      id: this.anchorId,
      customerId: this.customerId,
      customer: this.customerExtra || this.anchor?.customer,
      service: this.service(row?.serviceId) || this.anchor?.service,
      locationId: this.locationId,
    };
  }

  async retryCreation(): Promise<void> {
    try {
      await this.facade.retryAppointmentCreation();
      await this.facade.loadViewData();
      this.saved.emit();
      this.close.emit();
    } catch {
      this.feedback = this.facade.feedback();
    }
  }

  async retryUpdate(): Promise<void> {
    await this.facade.retryAppointmentUpdate();
    if (!this.pendingUpdate) {
      this.saved.emit();
      this.close.emit();
    } else this.feedback = this.facade.feedback();
  }

  onQuickCreated(kind: QuickCreateKind, entity: any): void {
    this.quickCreateKind = null;
    if (kind === "customer") {
      this.facade.addCustomer(entity);
      this.customerId = entity.id;
      this.customerExtra = entity;
    } else if (kind === "service") {
      this.facade.addCatalogService(entity);
      this.addService(entity.id);
    }
  }

  statusLabel(status: string): string {
    return appointmentStatusLabel(status);
  }

  historyLabel(row: any): string {
    const at = new Date(row.startsAt).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${row.service?.name || "Servizio"} · ${at} · ${appointmentStatusLabel(row.status)}`;
  }
}
