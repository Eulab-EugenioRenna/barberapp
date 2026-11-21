import { Injectable, inject, signal } from "@angular/core";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import {
  beginPendingCommand,
  clearPendingCommand,
  readPendingCommand,
  type PendingCommand,
  type PendingCommandState,
} from "@barber/shared/utils";
import { ADMIN_API_URL } from "./api-config";
import { SessionStore } from "./session.store";
import { selectedOperationalScope } from "./operational-context.service";
type Creation = "appointment" | "sale" | "sale-update" | "appointment-update";
@Injectable({ providedIn: "root" })
export class CreateRecoveryService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionStore);
  private readonly version = signal(0);
  private key(kind: Creation, targetId = "") {
    if (kind === "appointment-update") targetId = "";
    const user = this.session.currentUser();
    return `alora.create.${kind}:${user?.tenantId || ""}:${user?.id || ""}${targetId ? ":" + targetId : ""}`;
  }
  state(kind: Creation, targetId = ""): PendingCommandState {
    this.version();
    try {
      return readPendingCommand(sessionStorage, this.key(kind, targetId));
    } catch {
      return { kind: "unreadable" };
    }
  }
  create(kind: "appointment" | "sale", payload: Record<string, unknown>) {
    return this.write(kind, payload);
  }
  updateSale(id: string, payload: Record<string, unknown>) {
    return this.write("sale-update", payload, id);
  }
  updateAppointment(id: string, payload: Record<string, unknown>) {
    return this.write("appointment-update", payload, id);
  }
  private async write(
    kind: Creation,
    payload: Record<string, unknown>,
    targetId = "",
  ) {
    const user = this.session.currentUser();
    if (!user?.id) throw new Error("Sessione non disponibile");
    const scope = selectedOperationalScope(user.id),
      key = this.key(kind, targetId);
    let command: PendingCommand;
    try {
      command = beginPendingCommand(
        sessionStorage,
        key,
        kind === "appointment-update"
          ? { appointmentId: targetId, input: payload }
          : payload,
        {
          "X-Alora-Location":
            typeof payload["locationId"] === "string" && payload["locationId"]
              ? payload["locationId"]
              : scope.locationId,
          "X-Alora-Sector": payload["locationId"] ? "" : scope.sectorId,
        },
      );
    } catch {
      throw new Error(
        "Impossibile iniziare un nuovo invio: verifica la richiesta precedente o lo spazio della scheda",
      );
    }
    this.version.update((value) => value + 1);
    return this.send(kind, key, command, targetId);
  }
  retry(kind: Creation, targetId = "") {
    const state = this.state(kind, targetId);
    if (state.kind !== "pending")
      throw new Error(
        "Richiesta precedente non disponibile: verifica l'agenda o il conto",
      );
    return this.send(kind, this.key(kind, targetId), state.command, targetId);
  }
  private async send(
    kind: Creation,
    key: string,
    command: PendingCommand,
    targetId = "",
  ) {
    try {
      if (kind === "appointment-update") {
        const id = command.body["appointmentId"],
          input = command.body["input"];
        if (
          typeof id !== "string" ||
          !id ||
          !input ||
          typeof input !== "object" ||
          Array.isArray(input)
        )
          throw new Error("Modifica precedente non leggibile");
        const result = await firstValueFrom(
          this.http.patch(
            `${ADMIN_API_URL}/appointments/${encodeURIComponent(id)}`,
            { ...input, idempotencyKey: command.body.idempotencyKey },
            { headers: command.headers },
          ),
        );
        clearPendingCommand(sessionStorage, key, command.body.idempotencyKey);
        this.version.update((value) => value + 1);
        return result;
      }
      const result = await firstValueFrom(
        kind === "sale-update"
          ? this.http.patch(
              `${ADMIN_API_URL}/sales/${encodeURIComponent(targetId)}`,
              command.body,
              { headers: command.headers },
            )
          : this.http.post(
              `${ADMIN_API_URL}/${kind === "sale" ? "sales" : "appointments"}`,
              command.body,
              { headers: command.headers },
            ),
      );
      clearPendingCommand(sessionStorage, key, command.body.idempotencyKey);
      this.version.update((value) => value + 1);
      return result;
    } catch (error) {
      if (
        error instanceof HttpErrorResponse &&
        [400, 409].includes(error.status)
      ) {
        clearPendingCommand(sessionStorage, key, command.body.idempotencyKey);
        this.version.update((value) => value + 1);
        throw error;
      }
      throw new Error(
        "L'invio è ancora da verificare. Recupera l'esito della stessa richiesta prima di iniziarne un'altra.",
      );
    }
  }
}
