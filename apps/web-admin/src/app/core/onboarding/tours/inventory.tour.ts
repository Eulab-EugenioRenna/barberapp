import type { TourDefinition } from "../tour.types";

/** Guide of the warehouse: location, barcode, stock and movements. */
export const INVENTORY_TOUR: TourDefinition = {
  id: "inventory",
  navKey: "inventory",
  title: "Magazzino",
  // v3: movement sheet with type cards, cost/VAT/reason optional.
  version: 3,
  when: (ctx) => ctx.canView("inventory"),
  steps: (ctx) => {
    const canManage = ctx.can("inventory.manage");
    return [
      {
        title: "Il magazzino per sede",
        body: canManage
          ? "Qui controlli le giacenze di ogni sede e registri inventari, carichi, scarichi, rettifiche, trasferimenti e resi."
          : "Qui consulti le giacenze di ogni sede e il registro dei movimenti. Il tuo account non può registrare movimenti.",
      },
      {
        target: "inventory-location",
        title: "Scegli la sede",
        body: "Giacenze e movimenti sono sempre di una sede: sceglila qui. Accanto vedi quanti prodotti sono tracciati e quanti hanno già la giacenza aperta.",
      },
      {
        target: "inventory-barcode",
        title: "Leggi un barcode",
        body:
          "Scrivi il codice e premi Invio, oppure usa il lettore: funziona anche senza cliccare qui, purché tu non stia scrivendo in un altro campo. " +
          (canManage
            ? "Il prodotto trovato si apre in «Nuovo movimento» con quantità 1: ogni nuova scansione dello stesso prodotto aggiunge un pezzo, comodo per il carico merce. Un codice sconosciuto si può creare subito nel Listino."
            : "Il prodotto trovato viene selezionato e ne vedi il registro."),
      },
      {
        target: "inventory-search",
        title: "Cerca nelle giacenze",
        body: "Filtra l'elenco per nome o codice articolo.",
      },
      {
        target: "inventory-stock-list",
        title: "Giacenze",
        body:
          "Per ogni prodotto vedi quantità e valore netto, oppure «Da inventariare» se manca la quantità iniziale. " +
          "Compaiono solo i prodotti con il tracciamento attivo nel listino. Tocca un prodotto per selezionarlo.",
      },
      {
        target: "inventory-operation",
        title: "Registra un movimento",
        body:
          "«Nuovo movimento»: tocca il tipo (Inventario iniziale la prima volta, Carico, Scarico, Rettifica, Trasferimento, Reso), scrivi la quantità e, se vuoi, un motivo. " +
          "Costo e IVA sono facoltativi: se mancano vale l'ultimo costo noto. Se l'esito non arriva, «Ripeti la stessa operazione» la reinvia senza duplicarla.",
        fallback:
          "Tocca un prodotto delle giacenze: compare il pulsante «Nuovo movimento» per inventario iniziale, carico, scarico, rettifica, trasferimento o reso.",
        when: (c) => c.can("inventory.manage"),
      },
      {
        target: "inventory-movements",
        title: "Registro movimenti",
        body: "Tutti i movimenti del prodotto nella sede, con giacenza dopo ogni operazione e costo medio netto. Vendite e consumi dei servizi vengono scaricati in automatico.",
        fallback:
          "Selezionato un prodotto, sotto trovi il registro movimenti: ogni operazione con la giacenza risultante. Vendite e consumi dei servizi vengono scaricati in automatico.",
      },
      {
        target: "inventory-refresh",
        title: "Aggiorna",
        body: "Ricarica le giacenze della sede, ad esempio dopo vendite fatte da un'altra postazione.",
      },
      {
        target: "inventory-catalog-link",
        title: "Anagrafica nel Listino",
        body: "Prodotti, prezzi e tracciamento si gestiscono nel Listino: un prodotto compare qui solo dopo aver attivato «Traccia le giacenze per sede», nelle «Avanzate» della sua scheda.",
        when: (c) => c.can("services.read"),
      },
    ];
  },
};
