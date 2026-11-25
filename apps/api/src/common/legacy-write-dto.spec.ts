import { ValidationPipe } from "@nestjs/common";
import { LegacyWriteDto } from "./legacy-write.dto";

// Same options as main.ts: unknown properties are rejected.
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});
const check = (body: Record<string, unknown>) =>
  pipe.transform(body, { type: "body", metatype: LegacyWriteDto });

describe("LegacyWriteDto", () => {
  it("accepts the brand of a product, or null to remove it", async () => {
    await expect(check({ name: "Shampoo", brandId: "brand-1" })).resolves.toMatchObject({
      brandId: "brand-1",
    });
    await expect(check({ name: "Shampoo", brandId: null })).resolves.toBeDefined();
    await expect(check({ name: "Shampoo", brandId: "" })).resolves.toBeDefined();
  });
});
