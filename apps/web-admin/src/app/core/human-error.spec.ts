import { INVALID_MESSAGE, OFFLINE_MESSAGE, SERVER_MESSAGE, humanError } from "./human-error";

// Same shape as Angular's HttpErrorResponse (Angular is not loaded under jest).
const http = (status: number, error: unknown, url = "https://api.test/x") =>
  Object.assign(new Error(`Http failure response for ${url}: ${status} `), { name: "HttpErrorResponse", status, error, url });

describe("humanError", () => {
  it("speaks of the connection when the request never reached the server", () => {
    expect(humanError(http(0, { type: "error" }), "Salvataggio non riuscito")).toBe(OFFLINE_MESSAGE);
    expect(humanError(http(0, { message: "Il server impiega troppo tempo" }), "x")).toBe(OFFLINE_MESSAGE);
  });

  it("never shows Angular's own text", () => {
    const error = http(404, null);
    expect(error.message).toMatch(/^Http failure/);
    expect(humanError(error, "Cliente non trovato")).toBe("Cliente non trovato");
  });

  it("hides server internals behind one sentence", () => {
    expect(humanError(http(500, { message: "Internal server error" }), "x")).toBe(SERVER_MESSAGE);
    expect(humanError(http(502, "<html>Bad gateway</html>"), "x")).toBe(SERVER_MESSAGE);
  });

  it("turns class-validator output into «Dati non validi» with the field", () => {
    expect(humanError(http(400, { message: ["phone must be a string", "email must be an email"] }), "x"))
      .toBe(`${INVALID_MESSAGE}: controlla il campo «telefono»`);
    expect(humanError(http(400, { message: ["property foo should not exist"] }), "x"))
      .toBe(`${INVALID_MESSAGE}: controlla il campo «foo»`);
    expect(humanError(http(400, { message: "lines.0.serviceId must be a UUID" }), "x"))
      .toBe(`${INVALID_MESSAGE}: controlla il campo «servizio»`);
    expect(humanError(http(400, { message: ["each value in tags must be a string"] }), "x")).toBe(INVALID_MESSAGE);
  });

  it("keeps the Italian message written by the server", () => {
    expect(humanError(http(409, { message: "Orario già occupato" }), "x")).toBe("Orario già occupato");
    expect(humanError(http(400, { message: ["Il telefono è obbligatorio"] }), "x")).toBe("Il telefono è obbligatorio");
  });

  it("falls back for runtime errors and unknown values", () => {
    expect(humanError(new TypeError("Cannot read properties of undefined"), "Riprova")).toBe("Riprova");
    expect(humanError(undefined, "Riprova")).toBe("Riprova");
    expect(humanError({}, "Riprova")).toBe("Riprova");
    expect(humanError(new Error("Agenda personale non abilitata"), "x")).toBe("Agenda personale non abilitata");
  });

  it("gives permission and session failures their own words", () => {
    expect(humanError(http(403, null), "x")).toBe("Operazione non consentita per il tuo profilo");
    expect(humanError(http(401, null), "x")).toBe("Sessione scaduta: accedi di nuovo");
  });
});
