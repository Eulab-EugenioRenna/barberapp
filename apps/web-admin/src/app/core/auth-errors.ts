/** A temporary transport/provider failure is not proof that the user's session was revoked. */
export function isTransientAuthError(error: unknown): boolean {
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  return typeof status === "number" && (status === 0 || status === 429 || (status >= 500 && status < 600));
}
