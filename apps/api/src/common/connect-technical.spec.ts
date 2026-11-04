import { UnauthorizedException } from "@nestjs/common";
import type { ConnectServer } from "@eulab/connect/server";

import {
  checkTechnicalOperator,
  technicalHandoffHash,
  technicalSessionExpiresAt,
} from "./connect-technical";

function operatorToken(expiresInSeconds: number): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

describe("Connect access-as boundary", () => {
  it("hashes handoffs and never exposes the original value", () => {
    const handoff = "h".repeat(43);
    expect(technicalHandoffHash(handoff)).toMatch(/^[a-f0-9]{64}$/);
    expect(technicalHandoffHash(handoff)).not.toContain(handoff);
  });

  it("caps the local session at the shorter operator-token lifetime", () => {
    const short = technicalSessionExpiresAt(operatorToken(75));
    expect(short.getTime()).toBeLessThanOrEqual(Date.now() + 75_000);
    const long = technicalSessionExpiresAt(operatorToken(3_600));
    expect(long.getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
    const opaque = technicalSessionExpiresAt("not-a-jwt");
    expect(opaque.getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
  });

  it("requires a live EULab admin for the same installation", async () => {
    const request = jest.fn().mockResolvedValue({
      id: "installation-1",
      admin: true,
    });
    await expect(
      checkTechnicalOperator(
        { request } as unknown as ConnectServer,
        "installation-1",
        "operator-token",
      ),
    ).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      "/v1/context",
      "GET",
      undefined,
      "operator-token",
    );
    await expect(
      checkTechnicalOperator(
        {
          request: jest.fn().mockResolvedValue({
            id: "installation-1",
            admin: false,
          }),
        } as unknown as ConnectServer,
        "installation-1",
        "operator-token",
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      checkTechnicalOperator(
        {
          request: jest.fn().mockResolvedValue({
            id: "other-installation",
            admin: true,
          }),
        } as unknown as ConnectServer,
        "installation-1",
        "operator-token",
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
