import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestSession } from "./request-session";

type SessionScope = WeakMap<
  object,
  Map<string | undefined, Promise<RequestSession>>
>;
const scope = new AsyncLocalStorage<SessionScope>();

export function runRequestSessionScope<T>(
  operation: () => T,
  initial?: { prisma: object; authorization?: string; session: RequestSession },
): T {
  const sessions: SessionScope = new WeakMap();
  if (initial)
    sessions.set(
      initial.prisma,
      new Map([[initial.authorization, Promise.resolve(initial.session)]]),
    );
  return scope.run(sessions, operation);
}

export function resolveWithinRequest(
  prisma: object,
  authorization: string | undefined,
  load: () => Promise<RequestSession>,
): Promise<RequestSession> {
  const sessions = scope.getStore();
  if (!sessions) return load();
  let entries = sessions.get(prisma);
  if (!entries) {
    entries = new Map();
    sessions.set(prisma, entries);
  }
  const cached = entries.get(authorization);
  if (cached) return cached;
  const pending = load();
  entries.set(authorization, pending);
  return pending;
}
