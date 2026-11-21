import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import { Prisma } from "@prisma/client";
@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientValidationError,
  Prisma.PrismaClientUnknownRequestError,
)
export class PrismaErrorFilter implements ExceptionFilter {
  catch(
    error:
      | Prisma.PrismaClientKnownRequestError
      | Prisma.PrismaClientValidationError
      | Prisma.PrismaClientUnknownRequestError,
    host: ArgumentsHost,
  ): void {
    const codes: Record<string, [number, string]> = {
      P2025: [404, "Record non disponibile"],
      P2002: [409, "Operazione in conflitto con un record esistente"],
      P2004: [
        409,
        "Operazione incompatibile con sede, settore o disponibilità. Aggiorna e riprova.",
      ],
      P2003: [400, "Relazione non valida o record ancora utilizzato"],
    };
    // PostgreSQL trigger checks are surfaced as UnknownRequestError by Prisma 5.
    // Match only the connector SQLSTATE descriptor; never expose query/message text.
    const constraintConflict =
      (error instanceof Prisma.PrismaClientUnknownRequestError &&
        /kind: QueryError\(PostgresError \{ code: "23514"/.test(
          error.message,
        )) ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2010" &&
        error.meta?.["code"] === "23514");
    const [statusCode, message] =
      error instanceof Prisma.PrismaClientValidationError
        ? [400, "Dati non validi"]
        : constraintConflict
          ? [
              409,
              "Disponibilità o attribuzione operativa cambiate. Aggiorna e riprova.",
            ]
          : error instanceof Prisma.PrismaClientKnownRequestError
            ? (codes[error.code] ?? [500, "Operazione non riuscita"])
            : [500, "Operazione non riuscita"];
    host
      .switchToHttp()
      .getResponse()
      .status(statusCode)
      .json({ statusCode, message });
  }
}
