import { buildQuickOrderCustomerQuery } from "./quick-order-customer-query";

describe("buildQuickOrderCustomerQuery", () => {
  it("loads the latest five customers when the search is empty", () => {
    expect(buildQuickOrderCustomerQuery("   ")).toEqual({
      page: 1,
      pageSize: 5,
      search: "",
    });
  });

  it("sends the trimmed customer search to the API", () => {
    expect(buildQuickOrderCustomerQuery("  Mario Rossi  ")).toEqual({
      page: 1,
      pageSize: 5,
      search: "Mario Rossi",
    });
  });
});
