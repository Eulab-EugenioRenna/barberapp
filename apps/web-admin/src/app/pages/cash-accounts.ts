export type AccountKind = "toClose" | "open" | "registered";

export interface AccountRow {
  key: string;
  kind: AccountKind;
  when: string;
  customer: string;
  who: string;
  lines: string;
  total: number | null;
  appointment: any | null;
  sale: any | null;
}

export const KIND_LABELS: Record<AccountKind, string> = {
  toClose: "Da chiudere",
  open: "Aperto",
  registered: "Registrato",
};
const KIND_ORDER: Record<AccountKind, number> = { toClose: 0, open: 1, registered: 2 };

export const personName = (person: any) =>
  person ? `${person.firstName || ""} ${person.lastName || ""}`.trim() : "";

/**
 * One list for the whole till. An account moves through three labels:
 * "Da chiudere" (service time reached, not settled), "Aperto" (saved open,
 * today) and "Registrato" (confirmed sale, with its payment state).
 */
export function buildAccountRows(
  toClose: any[],
  openSales: any[],
  sales: any[],
  now = new Date(),
): AccountRow[] {
  const rows: AccountRow[] = [];
  const used = new Set<string>();
  const saleOf = (appointment: any) =>
    openSales.find(
      (sale) =>
        sale.appointmentId === appointment.id ||
        (sale.items || []).some((item: any) => item.booking?.id === appointment.id),
    ) ?? null;
  const saleLines = (sale: any) =>
    (sale?.items || [])
      .map((item: any) => item.service?.name || item.product?.name || item.label)
      .filter(Boolean)
      .join(" · ");
  for (const appointment of toClose) {
    const sale = saleOf(appointment);
    if (sale) used.add(sale.id);
    rows.push({
      key: "a:" + appointment.id,
      kind: "toClose",
      when: appointment.startsAt,
      customer: personName(appointment.customer) || "Cliente",
      who: personName(appointment.collaborator),
      lines: saleLines(sale) || appointment.service?.name || "Servizio",
      total: sale ? Number(sale.total || 0) : null,
      appointment,
      sale,
    });
  }
  for (const sale of openSales) {
    if (used.has(sale.id)) continue;
    const appointment =
      sale.appointment ??
      (sale.items || []).find((item: any) => item.booking)?.booking ??
      null;
    const started = new Date(sale.soldAt).getTime() <= now.getTime();
    rows.push({
      key: "s:" + sale.id,
      kind: started && appointment ? "toClose" : "open",
      when: sale.soldAt,
      customer: personName(sale.customer) || "Senza cliente",
      who: personName(sale.collaborator),
      lines: saleLines(sale),
      total: Number(sale.total || 0),
      appointment: appointment ? { ...appointment, customer: sale.customer } : null,
      sale,
    });
  }
  for (const sale of sales) {
    rows.push({
      key: "s:" + sale.id,
      kind: "registered",
      when: sale.soldAt,
      customer: personName(sale.customer) || "Vendita senza cliente",
      who: personName(sale.collaborator),
      lines: saleLines(sale),
      total: Number(sale.total || 0),
      appointment: null,
      sale,
    });
  }
  return rows.sort((a, b) => {
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    const diff = new Date(a.when).getTime() - new Date(b.when).getTime();
    // Waiting accounts oldest first; registered ones newest first.
    return a.kind === "registered" ? -diff : diff;
  });
}

