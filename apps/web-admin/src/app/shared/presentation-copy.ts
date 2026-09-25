const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  draft: "Bozza",
  requested: "Da confermare",
  confirmed: "Confermato",
  checked_in: "Cliente arrivato",
  completed: "Completato",
  cancelled: "Annullato",
  no_show: "Cliente assente",
  rescheduled: "Spostato",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  paid: "Pagato",
  partial: "Parzialmente pagato",
  unpaid: "Da pagare",
  refunded: "Rimborsato",
  cancelled: "Annullato",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Contanti",
  card: "Carta",
  transfer: "Bonifico",
  mixed: "Misto",
  other: "Altro",
};

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  trialing: "Periodo di prova",
  active: "Attivo",
  past_due: "Pagamento scaduto",
  suspended: "Sospeso",
  cancelled: "Annullato",
  unpaid: "Non pagato",
};

const BILLING_INTERVAL_LABELS: Record<string, string> = {
  monthly: "Mensile",
  yearly: "Annuale",
  one_time: "Una tantum",
};

const BOOKING_MODE_LABELS: Record<string, string> = {
  public: "Solo prenotazioni online",
  hybrid: "Online e dal salone",
  closed: "Solo dal salone",
};

const SERVICE_PRODUCT_MODE_LABELS: Record<string, string> = {
  optional: "Facoltativo",
  recommended: "Consigliato",
  included: "Incluso",
  required: "Obbligatorio",
};

function fallbackLabel(value: string | null | undefined): string {
  if (!value) return "Non indicato";
  return "Da verificare";
}

export function appointmentStatusLabel(value: string | null | undefined): string {
  return value ? APPOINTMENT_STATUS_LABELS[value] || fallbackLabel(value) : "Non indicato";
}

export function paymentStatusLabel(value: string | null | undefined): string {
  return value ? PAYMENT_STATUS_LABELS[value] || fallbackLabel(value) : "Non indicato";
}

export function paymentMethodLabel(value: string | null | undefined): string {
  return value ? PAYMENT_METHOD_LABELS[value] || fallbackLabel(value) : "Non indicato";
}

export function subscriptionStatusLabel(value: string | null | undefined): string {
  return value ? SUBSCRIPTION_STATUS_LABELS[value] || fallbackLabel(value) : "Non indicato";
}

export function billingIntervalLabel(value: string | null | undefined): string {
  return value ? BILLING_INTERVAL_LABELS[value] || fallbackLabel(value) : "Non indicato";
}

export function bookingModeLabel(value: string | null | undefined): string {
  return value ? BOOKING_MODE_LABELS[value] || fallbackLabel(value) : "Non indicato";
}

export function serviceProductModeLabel(value: string | null | undefined): string {
  return value ? SERVICE_PRODUCT_MODE_LABELS[value] || fallbackLabel(value) : "Non indicato";
}

export function activityStatusLabel(value: string | null | undefined): string {
  if (!value) return "Non indicato";
  return APPOINTMENT_STATUS_LABELS[value] || PAYMENT_STATUS_LABELS[value] || fallbackLabel(value);
}
