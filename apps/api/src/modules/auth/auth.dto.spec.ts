import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { LoginDto } from "./auth.dto";
describe("Optional local password during Connect sign-in", () => {
  it.each([undefined, ""])("accepts an omitted local password (%j)", async password => {
    const dto = plainToInstance(LoginDto, { email: "demo@barber.test", password });
    expect(dto.password).toBeUndefined();
    expect(await validate(dto)).toHaveLength(0);
  });
  it("preserves every character of a supplied legacy password", async () => {
    const dto = plainToInstance(LoginDto, { email: "demo@barber.test", password: "  exact-password  " });
    expect(dto.password).toBe("  exact-password  ");
    expect(await validate(dto)).toHaveLength(0);
  });
  it("rejects non-string and overlong values", async () => {
    for (const password of [42, {}, "x".repeat(4097)]) expect((await validate(plainToInstance(LoginDto, { email: "demo@barber.test", password }))).length).toBeGreaterThan(0);
  });
});
