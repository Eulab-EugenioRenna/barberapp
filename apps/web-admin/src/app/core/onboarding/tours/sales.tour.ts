import type { TourDefinition } from "../tour.types";

/**
 * Cassa, one flow: new account (sell now or book) → accounts to close →
 * open ones → registered sales. Labels, not separate pages.
 */
export const SALES_TOUR: TourDefinition = {
  id: "sales",
  navKey: "sales",
  title: "Cassa",
  // v2: "Conti da chiudere" merged into the till.
  version: 3,
  when: (ctx) => ctx.canView("sales"),
  steps: () => [
    {
      title: "Tutti i conti in un posto",
      body: (c) =>
        "Prenotazione, conto aperto e vendita sono lo stesso conto che cambia etichetta: " +
        "«Da chiudere» quando l'orario del servizio è arrivato, «Aperto» se salvato senza incasso, «Registrato» quando è confermato." +
        (c.can("sales.manage")
          ? ""
          : " Il tuo account può consultarli, non chiuderli né modificarli."),
    },
    {
      target: "header-new",
      title: "Nuovo",
      body: (c) =>
        [
          c.can("sales.manage") &&
            "«Vendi adesso»: solo prodotti, solo servizi o entrambi, anche senza prenotazione.",
          c.can("appointments.create") &&
            "«Prenota»: un appuntamento futuro, con il controllo di orari e disponibilità.",
        ]
          .filter(Boolean)
          .join(" "),
      when: (c) => c.can("sales.manage") || c.can("appointments.create"),
    },
    {
      title: "Ogni sede, le sue attività",
      body:
        "Il conto appartiene a una sede: la scegli in alto nella cassa. Compaiono solo i servizi delle attività svolte in quella sede, " +
        "mentre i prodotti si vendono ovunque. Se cambi sede, i servizi che lì non sono previsti escono dal conto con un avviso.",
      when: (c) => c.can("sales.manage"),
    },
    {
      title: "Servizi venduti senza prenotazione",
      body:
        "Nella cassa, quando aggiungi un servizio compare «Eseguito il / alle»: lascialo vuoto se il servizio finisce adesso, " +
        "oppure scegli un orario passato per registrarlo in ritardo. Alla conferma il servizio va in agenda come appuntamento completato. " +
        "Se il professionista era già occupato o fuori orario vedi un avviso, ma puoi registrare lo stesso.",
      when: (c) => c.can("sales.manage"),
    },
    {
      target: "sales-labels",
      title: "Le etichette",
      body: "Tocca un'etichetta per vedere solo quei conti, con il loro numero; «Tutti» li mostra di nuovo insieme.",
    },
    {
      target: "sales-search",
      title: "Cerca un conto",
      body: "Filtra per cliente, professionista, servizio, prodotto o etichetta.",
    },
    {
      target: ["sales-row-label", "sales-row", "sales-list"],
      title: "Un conto",
      body:
        "Ogni riga mostra cliente, orario, professionista, righe e totale; i conti da chiudere sono in cima, dal più vecchio. " +
        "I registrati riportano anche lo stato del pagamento.",
      fallback: "Quando registri o prenoti qualcosa, il conto compare qui con la sua etichetta.",
    },
    {
      target: "sales-close",
      title: "Chiudi il conto",
      body:
        "Apre la cassa già compilata con cliente e servizi: puoi aggiungere prodotti o altri servizi, " +
        "controllare importi e pagamento, poi «Registra vendita». Il conto diventa «Registrato» e l'appuntamento completato.",
      when: (c) => c.can("sales.manage"),
    },
    {
      target: "sales-link",
      title: "Collega una vendita già fatta",
      body:
        "Se hai già incassato con una vendita senza appuntamento, collegala qui: il conto si chiude senza un secondo incasso.",
      when: (c) => c.can("sales.manage"),
    },
    {
      target: "sales-cancel",
      title: "Annulla appuntamento",
      body: "Se il servizio non è avvenuto e non va incassato, annulla l'appuntamento: ti viene chiesta conferma.",
      when: (c) => c.can("appointments.update.all"),
    },
    {
      title: "Conti registrati",
      body: (c) =>
        "Tocca un conto «Registrato» per vederne righe, sconti, totali, pagamento e appuntamento collegato." +
        (c.can("sales.manage")
          ? " Dal dettaglio puoi modificarlo o eliminarlo (l'appuntamento collegato resta)."
          : ""),
    },
  ],
};
