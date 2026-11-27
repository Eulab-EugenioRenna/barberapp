import type { TourDefinition } from "../tour.types";

/** Guide of the customers page: search, customer card and history. */
export const CUSTOMERS_TOUR: TourDefinition = {
  id: "customers",
  navKey: "customers",
  title: "Clienti",
  // v5: card in two columns, summary and filters under «Riepilogo e filtri».
  version: 5,
  when: (ctx) => ctx.canView("customers"),
  steps: (ctx) => {
    const canManage = ctx.can("clients.manage");
    return [
      {
        title: "Le schede dei tuoi clienti",
        body: canManage
          ? "Qui trovi tutti i clienti dell'attività: contatti, tag, note e lo storico di prenotazioni e acquisti. Puoi crearli, aggiornarli ed eliminarli."
          : "Qui consulti i clienti dell'attività: contatti, tag, note e lo storico di prenotazioni e acquisti. Il tuo account può leggere le schede ma non modificarle.",
      },
      {
        target: "customers-search",
        title: "Cerca un cliente",
        body: "Scrivi nome, email o telefono: la ricerca parte da sola dopo un attimo e cerca in tutto l'archivio, non solo nella pagina caricata.",
      },
      {
        target: "customers-list",
        title: "Elenco clienti",
        body:
          "Ogni scheda mostra contatti e tag: in blu quelli automatici (sedute, appuntamenti completati, spesa), in grigio quelli inseriti a mano. " +
          "Scorrendo in fondo si caricano altri clienti.",
      },
      {
        target: "customers-list",
        title: "Apri la scheda",
        body: canManage
          ? "Tocca un cliente: a sinistra l'anagrafica da modificare, a destra lo storico. Nello storico cerchi per servizio, prodotto, professionista o note; apri «Riepilogo e filtri» per speso, visite, ultima e prossima visita e per filtrare per tipo e periodo. Tocca una voce per il dettaglio."
          : "Tocca un cliente: a sinistra l'anagrafica, a destra lo storico. Apri «Riepilogo e filtri» per speso, visite e filtri per tipo e periodo; tocca una voce per il dettaglio.",
      },
      {
        target: "customers-new",
        title: "Nuovo cliente",
        body: "Apre la scheda vuota: nome e cognome sono obbligatori, telefono, email, tag (separati da virgola) e note puoi aggiungerli dopo. Poi «Crea cliente».",
        when: (c) => c.can("clients.manage"),
      },
      {
        target: "customers-whatsapp-all",
        title: "Messaggio a tutti",
        body: "Invia lo stesso messaggio WhatsApp, dal tuo numero collegato, a tutti i clienti con telefono. Parte in background a gruppi di 30: puoi chiudere la finestra e riaprirla per vedere l'avanzamento. Chi ha già ricevuto lo stesso testo non lo riceve due volte. Per un solo cliente usa «Invia messaggio» nella sua scheda.",
        when: (c) => c.can("whatsapp.send"),
      },
      {
        title: canManage ? "Modifiche ed eliminazione" : "Tutto pronto",
        body: canManage
          ? "In fondo alla scheda aperta salvi con «Salva»; «Elimina» chiede sempre conferma prima di cancellare il contatto."
          : "Per creare o modificare clienti chiedi al titolare di abilitare la gestione clienti sul tuo account.",
      },
    ];
  },
};
