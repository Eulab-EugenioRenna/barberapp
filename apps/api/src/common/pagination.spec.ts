import {
  buildPaginatedResult,
  isPaginationRequested,
  parsePagination,
} from "./pagination";

describe("pagination helpers", () => {
  it("defaults to the first page", () => {
    expect(parsePagination(undefined)).toEqual({
      page: 1,
      pageSize: 25,
      skip: 0,
      take: 25,
    });
  });

  it("parses page and pageSize and computes skip", () => {
    expect(parsePagination({ page: "3", pageSize: "10" })).toEqual({
      page: 3,
      pageSize: 10,
      skip: 20,
      take: 10,
    });
  });

  it("caps the page size and rejects invalid values", () => {
    expect(parsePagination({ page: "-2", pageSize: "9999" })).toEqual({
      page: 1,
      pageSize: 200,
      skip: 0,
      take: 200,
    });
  });

  it("builds a paginated envelope with nextPage", () => {
    expect(buildPaginatedResult(["a", "b"], 5, 1, 2)).toEqual({
      items: ["a", "b"],
      total: 5,
      page: 1,
      pageSize: 2,
      hasMore: true,
      nextPage: 2,
    });
  });

  it("reports the last page", () => {
    expect(buildPaginatedResult(["e"], 5, 3, 2)).toEqual({
      items: ["e"],
      total: 5,
      page: 3,
      pageSize: 2,
      hasMore: false,
      nextPage: null,
    });
  });

  it("detects when pagination is explicitly requested", () => {
    expect(isPaginationRequested({})).toBe(false);
    expect(isPaginationRequested({ page: "1" })).toBe(true);
    expect(isPaginationRequested({ limit: "10" })).toBe(true);
  });
});