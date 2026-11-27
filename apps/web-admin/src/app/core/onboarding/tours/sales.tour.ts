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
  // v4: quick sale modal (barcode in the title bar, one row per line, VAT from the price list).
  // v7: «Nuova vendita» in the page head, secondary row actions in «…».
  // v8: no «Eseguito il» in the till, sale detail with Modifica / Annulla / Elimina.
  version: 8,
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
      target: "sales-new",
      title: "Nuova vendita",
      body:
        "Apre la cassa: solo prodotti, solo servizi o entrambi, anche senza prenotazione. " +
        "Per un appuntamento futuro usa «Nuovo › Prenota» in Agenda.",
      when: (c) => c.can("sales.manage"),
    },
    {
      title: "La cassa veloce",
      body:
        "In alto, accanto al titolo, scansiona o scrivi il barcode e premi Invio. Nel riepilogo ogni riga ha quantità, prezzo e professionista: " +
        "tocca il prezzo per cambiarlo, anche con il tastierino, e trascina una riga per riordinarla. Nella griglia, tieni premuta una card per spostarla: l'ordine resta salvato. IVA e tipo di prezzo arrivano dal listino e si impostano " +
        "nelle pagine di servizi e prodotti. Il pagamento parte già su Contanti, pagato.",
      when: (c) => c.can("sales.manage"),
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
        "Nella cassa i servizi venduti senza prenotazione vanno in agenda come appuntamento completato, finito adesso. " +
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
      target: "sales-more",
      title: "Le altre azioni",
      body:
        "Nel menu «…» della riga: «Collega una vendita già fatta» chiude il conto senza un secondo incasso; " +
        "«Annulla appuntamento» se il servizio non è avvenuto e non va incassato (ti viene chiesta conferma).",
      when: (c) => c.can("sales.manage") || c.can("appointments.update.all"),
    },
    {
      title: "Conti registrati",
      body: (c) =>
        "Tocca un conto «Registrato» per vederne righe, sconti, totali, pagamento e appuntamento collegato." +
        (c.can("sales.manage")
          ? " In basso trovi «Modifica vendita», «Annulla vendita» (rimborsa gli incassi, rimette i prodotti in magazzino e annulla gli appuntamenti ancora da fare) " +
            "ed «Elimina vendita» (toglie la vendita con incassi e appuntamenti del conto)."
          : ""),
    },
  ],
};
