import { BadRequestException } from "@nestjs/common";
import type { ValidationError } from "class-validator";

/** class-validator's own English wording («x must be a string», «property y should not exist», …). */
const DEFAULT_ENGLISH = /\b(must|should|has failed|is not|cannot|an instance of|is invalid)\b/i;
const isDefaultMessage = (message: string) => /^[\x20-\x7e]*$/.test(message) && DEFAULT_ENGLISH.test(message);

/** Leaf errors with their full property path («items.0.name»). */
function leaves(errors: ValidationError[], parent = ""): Array<{ path: string; error: ValidationError }> {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const own = error.constraints && Object.keys(error.constraints).length ? [{ path, error }] : [];
    return [...own, ...leaves(error.children ?? [], path)];
  });
}

/**
 * Validation messages in Italian for the admin: custom DTO messages stay as
 * written, class-validator's default English becomes «Dati non validi: controlla
 * il campo «x»». The first failing field comes first.
 */
export function validationMessages(errors: ValidationError[]): string[] {
  const messages: string[] = [];
  for (const { path, error } of leaves(errors)) {
    for (const [key, message] of Object.entries(error.constraints ?? {})) {
      const text = key === "whitelistValidation"
        ? `Campo non previsto: «${path}»`
        : isDefaultMessage(message) ? `Dati non validi: controlla il campo «${path}»` : message;
      if (!messages.includes(text)) messages.push(text);
    }
  }
  return messages.length ? messages : ["Dati non validi"];
}

/** `exceptionFactory` of the global ValidationPipe: same 400 shape as Nest's, Italian messages. */
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  return new BadRequestException({ message: validationMessages(errors), error: "Bad Request", statusCode: 400 });
}
