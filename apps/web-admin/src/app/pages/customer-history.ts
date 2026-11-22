/** Customer card history: one flat, filterable list of appointments and accounts. */

export type HistoryKind = "appointment" | "sale";
export type HistoryKindFilter = "all" | HistoryKind;
export type HistoryPeriod = "all" | "30d" | "6m" | "12m";

export interface HistoryRow {
  id: string;
  kind: HistoryKind;
  at: string;
  future: boolean;
  title: string;
  subtitle: string;
  status: string;
  amount: number | null;
  /** Account lines (sales) or customer notes (appointments). */
  lines: Array<{ label: string; quantity: number; total: number }>;
  notes: string;
  paymentMethod: string;
  /** Appointment already settled in an account. */
  settled: boolean;
  search: string;
}

export interface HistorySummary {
  spent: number;
  visits: number;
  lastVisit: string | null;
  nextAppointment: string | null;
  noShows: number;
}

const INACTIVE = ["cancelled", "no_show"];

const person = (value: any) =>
  `${value?.firstName ?? ""} ${value?.lastName ?? ""}`.trim();

const itemLabel = (item: any) =>
  item?.service?.name || item?.product?.name || item?.label || "Voce";

export function buildHistoryRows(history: any, now = new Date()): HistoryRow[] {
  const appointments: any[] = Array.isArray(history?.appointments) ? history.appointments : [];
  const sales: any[] = Array.isArray(history?.sales) ? history.sales : [];
  const settledItems = new Set(
    sales.flatMap((sale) => (sale.items || []).map((item: any) => item.id)).filter(Boolean),
  );
  const rows: HistoryRow[] = [
    ...appointments.map((appointment): HistoryRow => {
      const collaborator = person(appointment.collaborator);
      const title = appointment.service?.name || "Appuntamento";
      const notes = appointment.customerNotes || appointment.internalNotes || "";
      return {
        id: `a:${appointment.id}`,
        kind: "appointment",
        at: appointment.startsAt,
        future: new Date(appointment.startsAt).getTime() > now.getTime(),
        title,
        subtitle: collaborator || "Professionista non assegnato",
        status: appointment.status || "",
        amount: null,
        lines: [],
        notes,
        paymentMethod: "",
        settled: !!appointment.orderItemId && settledItems.has(appointment.orderItemId),
        search: [title, collaborator, notes].join(" ").toLowerCase(),
      };
    }),
    ...sales.map((sale): HistoryRow => {
      const lines = (sale.items || []).map((item: any) => ({
        label: itemLabel(item),
        quantity: Number(item.quantity || 1),
        total: Number(item.lineTotal ?? 0),
      }));
      const title = lines.length
        ? lines.map((line: { label: string }) => line.label).join(" · ")
        : "Conto";
      return {
        id: `s:${sale.id}`,
        kind: "sale",
        at: sale.soldAt || sale.createdAt,
        future: false,
        title,
        subtitle: "",
        status: sale.paymentStatus || "",
        amount: Number(sale.total ?? 0),
        lines,
        notes: sale.notes || "",
        paymentMethod: sale.paymentMethod || "",
        settled: false,
        search: [title, sale.notes, sale.paymentMethod].join(" ").toLowerCase(),
      };
    }),
  ];
  return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export function filterHistoryRows(
  rows: readonly HistoryRow[],
  filters: { kind: HistoryKindFilter; period: HistoryPeriod; query: string },
  now = new Date(),
): HistoryRow[] {
  const since = periodStart(filters.period, now);
  const terms = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(
    (row) =>
      (filters.kind === "all" || row.kind === filters.kind) &&
      // Upcoming appointments always stay visible: they are not "old" history.
      (!since || row.future || new Date(row.at).getTime() >= since.getTime()) &&
      terms.every((term) => row.search.includes(term)),
  );
}

export function summarizeHistory(history: any, now = new Date()): HistorySummary {
  const appointments: any[] = Array.isArray(history?.appointments) ? history.appointments : [];
  const past = appointments.filter(
    (a) => new Date(a.startsAt).getTime() <= now.getTime() && !INACTIVE.includes(a.status),
  );
  const upcoming = appointments
    .filter((a) => new Date(a.startsAt).getTime() > now.getTime() && !INACTIVE.includes(a.status))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const lastVisit = past
    .map((a) => a.startsAt as string)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  return {
    spent: Number(history?.salesTotal ?? 0),
    visits: past.length,
    lastVisit: lastVisit ?? null,
    nextAppointment: upcoming[0]?.startsAt ?? null,
    noShows: appointments.filter((a) => a.status === "no_show").length,
  };
}

function periodStart(period: HistoryPeriod, now: Date): Date | null {
  const date = new Date(now);
  if (period === "30d") date.setDate(date.getDate() - 30);
  else if (period === "6m") date.setMonth(date.getMonth() - 6);
  else if (period === "12m") date.setFullYear(date.getFullYear() - 1);
  else return null;
  return date;
}
