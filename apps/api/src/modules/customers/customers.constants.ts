export const CUSTOMERS_ALIGNMENT_QUEUE = "customers-alignment";

export const CUSTOMERS_CACHE_PREFIX = "customers";

export const CUSTOMERS_ALIGNMENT_TTL_SECONDS = 24 * 60 * 60;

export const CUSTOMER_LOYALTY_TIERS = {
  new: "new",
  returning: "returning",
  regular: "regular",
  vip: "vip",
} as const;
