import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import { Prisma } from "@prisma/client";
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientValidationError)
export class PrismaErrorFilter implements ExceptionFilter {
  catch(
    error:
      | Prisma.PrismaClientKnownRequestError
      | Prisma.PrismaClientValidationError,
    host: ArgumentsHost,
  ): void {
    const codes: Record<string, [number, string]> = {
      P2025: [404, "Record non disponibile"],
      P2002: [409, "Operazione in conflitto con un record esistente"],
      P2003: [400, "Relazione non valida o record ancora utilizzato"],
    };
    const [statusCode, message] =
      error instanceof Prisma.PrismaClientValidationError
        ? [400, "Dati non validi"]
        : (codes[error.code] ?? [500, "Operazione non riuscita"]);
    host
      .switchToHttp()
      .getResponse()
      .status(statusCode)
      .json({ statusCode, message });
  }
}
