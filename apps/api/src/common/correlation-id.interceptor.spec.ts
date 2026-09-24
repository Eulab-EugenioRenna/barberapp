import { of } from "rxjs";
import { CorrelationIdInterceptor } from "./correlation-id.interceptor";

describe("CorrelationIdInterceptor", () => {
  it("does not mutate headers after an SSE response has started", () => {
    const setHeader = jest.fn();
    const interceptor = new CorrelationIdInterceptor();

    const result = interceptor.intercept(
      {
        switchToHttp: () => ({
          getResponse: () => ({ headersSent: true, setHeader }),
        }),
      } as never,
      { handle: () => of("event") },
    );

    expect(setHeader).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("sets the correlation header on ordinary responses", () => {
    const setHeader = jest.fn();
    const interceptor = new CorrelationIdInterceptor();

    interceptor.intercept(
      {
        switchToHttp: () => ({
          getResponse: () => ({ headersSent: false, setHeader }),
        }),
      } as never,
      { handle: () => of("response") },
    );

    expect(setHeader).toHaveBeenCalledWith(
      "x-correlation-id",
      expect.any(String),
    );
  });
});
