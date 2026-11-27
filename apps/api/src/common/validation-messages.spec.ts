import { ValidationPipe } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsNotEmpty, IsString, MaxLength, ValidateNested } from "class-validator";
import { validationExceptionFactory, validationMessages } from "./validation-messages";

class Line {
  @IsString() name!: string;
}
class Body {
  @IsString() @IsNotEmpty({ message: "Scrivi il nome del brand" }) brand!: string;
  @IsString() @MaxLength(5) code!: string;
  @ValidateNested({ each: true }) @Type(() => Line) lines!: Line[];
}
const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true, exceptionFactory: validationExceptionFactory });
const fail = async (value: unknown) => {
  try {
    await pipe.transform(value, { type: "body", metatype: Body });
  } catch (error: any) {
    return error.getResponse();
  }
  throw new Error("expected a validation error");
};

describe("global validation messages", () => {
  it("turns default English into Italian per field, nested paths included", async () => {
    const response = await fail({ brand: "B", code: "too-long", lines: [{ name: 3 }] });
    expect(response).toEqual({
      statusCode: 400, error: "Bad Request",
      message: ["Dati non validi: controlla il campo «code»", "Dati non validi: controlla il campo «lines.0.name»"],
    });
  });
  it("keeps custom DTO messages as written", async () => {
    const response = await fail({ brand: "", code: "a", lines: [] });
    expect(response.message).toEqual(["Scrivi il nome del brand"]);
  });
  it("names a field that is not accepted", async () => {
    const response = await fail({ brand: "B", code: "a", lines: [], extra: 1 });
    expect(response.message).toEqual(["Campo non previsto: «extra»"]);
  });
  it("never returns an empty list", () => {
    expect(validationMessages([])).toEqual(["Dati non validi"]);
  });
});
