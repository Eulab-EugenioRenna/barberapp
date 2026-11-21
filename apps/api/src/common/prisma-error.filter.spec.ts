import { Prisma } from "@prisma/client";
import { PrismaErrorFilter } from "./prisma-error.filter";
describe("Database scope/concurrency error response", () => {
  function response(message: string) {
    const json = jest.fn(),
      status = jest.fn(() => ({ json }));
    new PrismaErrorFilter().catch(
      new Prisma.PrismaClientUnknownRequestError(message, {
        clientVersion: "5.22.0",
      }),
      { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as never,
    );
    return { status, json };
  }
  it("maps the PostgreSQL trigger conflict to 409 without exposing SQL or private values", () => {
    const result = response(
      'ConnectorError { kind: QueryError(PostgresError { code: "23514", message: "private database text" }) }',
    );
    expect(result.status).toHaveBeenCalledWith(409);
    expect(JSON.stringify(result.json.mock.calls)).not.toContain(
      "private database text",
    );
    expect(JSON.stringify(result.json.mock.calls)).not.toContain(
      "PostgresError",
    );
  });
  it("does not disguise an unknown database failure as a booking conflict", () => {
    const result = response(
      'ConnectorError { kind: QueryError(PostgresError { code: "XX000", message: "private database text" }) }',
    );
    expect(result.status).toHaveBeenCalledWith(500);
    expect(result.json).toHaveBeenCalledWith({
      statusCode: 500,
      message: "Operazione non riuscita",
    });
  });
  it("reports a deferred PostgreSQL constraint raised before acknowledgement as a safe conflict", () => {
    const json = jest.fn(),
      status = jest.fn(() => ({ json }));
    new PrismaErrorFilter().catch(
      new Prisma.PrismaClientKnownRequestError("private raw query", {
        code: "P2010",
        clientVersion: "5.22.0",
        meta: { code: "23514", message: "private constraint value" },
      }),
      { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as never,
    );
    expect(status).toHaveBeenCalledWith(409);
    expect(JSON.stringify(json.mock.calls)).not.toContain("private");
  });
});
