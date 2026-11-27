import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import { Prisma } from "@prisma/client";

const GENERIC_CONFLICT =
  "Disponibilità o attribuzione operativa cambiate. Aggiorna e riprova.";
// SQLSTATEs raised by ALORA database guards (check_violation, raise_exception, no_data_found).
const GUARD_CODES = ["23514", "P0001", "P0002"];

/** Text of a database message written by ALORA (Italian), or null for anything else. */
export function ownDatabaseMessage(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const message = text
    .replace(/^(db error:\s*)?(ERROR:\s*)?/i, "")
    .split("\n")[0]
    .trim();
  if (!message || message.length > 300) return null;
  // PostgreSQL's own messages (English) never reach the user verbatim.
  if (
    /violates|constraint|relation "|duplicate key|null value|syntax|permission denied|deadlock|could not|does not exist|column|transaction/i.test(
      message,
    )
  )
    return null;
  const italian =
    /[àèéìòù]/i.test(message) ||
    /\b(il|la|le|lo|gli|del|della|dei|di|da|non|un|una|prima|con|per|fuori|conto|registro|giacenza|prenotazione|servizio|incasso|rimborso|vendita|movimento|operazione|sede|settore|cliente|riga)\b/i.test(
      message,
    );
  return italian ? message : null;
}

/** SQLSTATE and message of a database error surfaced by Prisma 5, if any. */
export function databaseError(
  error: unknown,
): { code: string; message: string | null } | null {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2010"
  ) {
    const code = String(error.meta?.["code"] ?? "");
    return { code, message: ownDatabaseMessage(error.meta?.["message"]) };
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    const code = /PostgresError \{ code: "([0-9A-Z]{5})"/.exec(error.message);
    if (!code) return null;
    const text = /message: "((?:[^"\\]|\\.)*)"/.exec(error.message);
    return {
      code: code[1],
      message: ownDatabaseMessage(
        text ? text[1].replace(/\\(.)/g, "$1") : null,
      ),
    };
  }
  return null;
}

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
    // PostgreSQL trigger checks are surfaced as UnknownRequestError (or P2010 for raw
    // queries) by Prisma 5. Our own Italian RAISE text is shown as is; anything else
    // stays generic and never exposes query text.
    const database = databaseError(error);
    const guard = database && GUARD_CODES.includes(database.code);
    const [statusCode, message] =
      error instanceof Prisma.PrismaClientValidationError
        ? [400, "Dati non validi"]
        : guard
          ? [409, database.message ?? GENERIC_CONFLICT]
          : error instanceof Prisma.PrismaClientKnownRequestError &&
              codes[error.code]
            ? codes[error.code]
            : [500, "Operazione non riuscita"];
    host
      .switchToHttp()
      .getResponse()
      .status(statusCode)
      .json({ statusCode, message });
  }
}
