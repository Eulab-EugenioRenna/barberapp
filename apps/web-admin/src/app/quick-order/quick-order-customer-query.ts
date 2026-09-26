export const QUICK_ORDER_CUSTOMER_LIMIT = 5;

export function buildQuickOrderCustomerQuery(search: string): {
  page: number;
  pageSize: number;
  search: string;
} {
  return {
    page: 1,
    pageSize: QUICK_ORDER_CUSTOMER_LIMIT,
    search: search.trim(),
  };
}
