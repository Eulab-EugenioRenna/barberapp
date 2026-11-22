import type { TourDefinition, TourStep } from "../tour.types";

/** Guide of the price list: services, products and their prices. */
export const SERVICES_TOUR: TourDefinition = {
  id: "services",
  navKey: "services",
  title: "Listino",
  version: 3,
  when: (ctx) => ctx.canView("services"),
  steps: (ctx) => {
    const services = ctx.can("services.read");
    const products = ctx.can("services.read");
    const intro =
      services && products
        ? "A sinistra i servizi che si prenotano in agenda, a destra i prodotti che vendi in cassa."
        : services
          ? "Qui trovi i servizi che si prenotano in agenda, con durata e prezzo."
          : "Qui trovi i prodotti che vendi in cassa, con prezzi e imposte.";
    const steps: TourStep[] = [
      {
        title: "Il tuo listino",
        body: `${intro} Le modifiche valgono per le nuove operazioni: i conti già registrati non cambiano.`,
      },
      {
        target: "services-search-service",
        title: "Cerca un servizio",
        body: "Filtra al volo l'elenco per nome o descrizione.",
        when: (c) => c.can("services.read"),
      },
      {
        target: "services-service-list",
        title: "Servizi e trattamenti",
        body: ctx.can("services.manage")
          ? "Ogni riga mostra prezzo base e durata; «Disattivato» indica un servizio non più usabile. Tocca un servizio per modificarlo: prezzi e IVA, attività, durata, colore in agenda, visibilità e prenotazione online."
          : "Ogni riga mostra prezzo base e durata; «Disattivato» indica un servizio non più usabile. Tocca un servizio per vederne i dettagli e lo storico dei prezzi.",
        when: (c) => c.can("services.read"),
      },
      {
        target: "services-new-service",
        title: "Nuovo servizio",
        body:
          "Apre il modulo del servizio: servono nome, durata e attività. L'attività decide dove si offre il servizio: in tutte le sedi che la svolgono, senza duplicarlo. " +
          "Dopo il primo salvataggio puoi collegare i prodotti consigliati" +
          (ctx.can("inventory.manage") ? " e il consumo che scarica il magazzino a ogni servizio." : "."),
        when: (c) => c.can("services.manage"),
      },
      {
        target: "services-activity-filter",
        title: "Filtra per attività",
        body: "Mostra solo i servizi e i prodotti di un'attività, per esempio Barberia o Estetica.",
        when: (c) => c.can("services.read"),
      },
      {
        target: "services-search-product",
        title: "Cerca un prodotto",
        body: ctx.can("services.manage")
          ? "Filtra per nome, descrizione o barcode. Con il lettore puoi anche scansionare un prodotto ovunque nella pagina: se esiste si apre la sua scheda, altrimenti ne inizia uno nuovo con il codice già inserito."
          : "Filtra per nome, descrizione o barcode; con il lettore la scansione apre direttamente il prodotto.",
        when: (c) => c.can("services.read"),
      },
      {
        target: "services-product-list",
        title: "Prodotti in vendita",
        body: ctx.can("services.manage")
          ? "Ogni prodotto mostra il prezzo, oppure «Prezzo libero» se lo decidi al momento della vendita. Tocca un prodotto per modificarne prezzo, costo, IVA e descrizione."
          : "Ogni prodotto mostra il prezzo, oppure «Prezzo libero» se viene deciso al momento della vendita. Tocca un prodotto per vederne i dettagli.",
        when: (c) => c.can("services.read"),
      },
      {
        target: "services-new-product",
        title: "Nuovo prodotto",
        body:
          "Apre il modulo del prodotto: basta il nome, il prezzo è facoltativo. L'attività parte da «Rivendita» e puoi cambiarla (es. Barberia per la cera). Il campo Barcode si compila scansionando la confezione. Puoi registrare costo di acquisto e IVA" +
          (ctx.can("inventory.manage")
            ? " e attivare «Traccia le giacenze per sede» per gestirlo in Magazzino."
            : "."),
        when: (c) => c.can("services.manage"),
      },
    ];
    if (ctx.can("services.manage")) {
      steps.push({
        title: "Disattivare senza perdere lo storico",
        body:
          "«Elimina» nella scheda disattiva il servizio o il prodotto e conserva prezzi e movimenti passati. " +
          "Indica il «Motivo aggiornamento listino» quando cambi un prezzo: lo ritrovi nello «Storico prezzi».",
      });
    }
    return steps;
  },
};
