export type CustomerIdentityInput = {
  tenantId: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
};

export type CustomerAlignmentJob = {
  tenantId: string;
  customerId?: string;
  reason:
    | "daily_get"
    | "appointment_created"
    | "sale_created"
    | "customer_updated";
};
