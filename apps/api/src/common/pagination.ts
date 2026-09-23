export interface PaginationInput {
  page?: string | number;
  pageSize?: string | number;
  limit?: string | number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  nextPage: number | null;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;

export function parsePagination(
  input: PaginationInput | undefined,
  options: { defaultPageSize?: number; maxPageSize?: number } = {},
): { page: number; pageSize: number; skip: number; take: number } {
  const defaultPageSize = options.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const maxPageSize = options.maxPageSize ?? MAX_PAGE_SIZE;

  const parsedPage = Number.parseInt(String(input?.page ?? "1"), 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const requestedPageSize = Number.parseInt(
    String(input?.pageSize ?? input?.limit ?? defaultPageSize),
    10,
  );
  const pageSize =
    Number.isFinite(requestedPageSize) && requestedPageSize > 0
      ? Math.min(requestedPageSize, maxPageSize)
      : defaultPageSize;

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function buildPaginatedResult<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  const hasMore = page * pageSize < total;

  return {
    items,
    total,
    page,
    pageSize,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
  };
}

export function isPaginationRequested(input: PaginationInput | undefined): boolean {
  if (!input) {
    return false;
  }

  return input.page !== undefined || input.pageSize !== undefined || input.limit !== undefined;
}