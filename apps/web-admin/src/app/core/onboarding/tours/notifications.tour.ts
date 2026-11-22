import type { TourDefinition } from "../tour.types";

/**
 * Tour of "Promemoria e notifiche". The rules tab loads its policy only after
 * «Configura promemoria», so the form steps appear only once it is open.
 */
export const NOTIFICATIONS_TOUR: TourDefinition = {
  id: "notifications",
  navKey: "notifications",
  title: "Promemoria e notifiche",
  version: 1,
  // Same rule as the menu entry (companyFunction("notifications.manage")).
  when: (ctx) => ctx.can("notifications.manage"),
  steps: () => [
    {
      title: "Promemoria e notifiche",
      body: "Qui imposti i messaggi automatici degli appuntamenti: promemoria e conferme su WhatsApp, avvisi allo staff e testi di email e notifiche. Ti mostro l'ordine giusto per attivarli.",
    },
    {
      target: "tab-connection",
      title: "1. Collegamento Connect",
      body: "Si parte da qui, una volta sola: autorizzi ogni canale (WhatsApp, email, avvisi nell'app) e, a parte, le azioni del cliente sull'agenda. Ogni autorizzazione ha una scadenza ed è revocabile.",
    },
    {
      target: "notifications-load",
      title: "2. Configura i promemoria",
      body: "Carica la policy salvata dei promemoria: si aprono le opzioni, gli orari di invio, i testi WhatsApp e l'attivazione.",
    },
    {
      target: "notifications-status",
      title: "Stato degli invii",
      body: "Ti dice se i promemoria sono attivi o in bozza. Valgono solo per le nuove prenotazioni con consenso WhatsApp: quelle già presenti non ricevono invii retroattivi.",
    },
    {
      target: "notifications-options",
      title: "Conferma e risposta",
      body: "Scegli se mandare un messaggio iniziale alla prenotazione e se chiedere al cliente di rispondere (confermo, richiedo modifica, annullo). Sotto decidi se avvisarlo anche quando l'appuntamento viene confermato, annullato o riprogrammato.",
    },
    {
      target: "notifications-timing",
      title: "Quando inviare",
      body: "Anticipo del primo promemoria, quanti inviarne e ogni quanto, scadenza della risposta e fascia oraria degli invii. Con 0 promemoria restano solo gli avvisi sugli eventi.",
    },
    {
      target: "notifications-texts",
      title: "Testi WhatsApp",
      body: "Scrivi i messaggi usando i segnaposto (nome cliente, servizio, orario…). Non inserire dati sensibili.",
    },
    {
      target: "notifications-save",
      title: "Salva la bozza",
      body: "Salva le regole come bozza: gli invii non partono ancora. Se la policy era attiva, salvare una nuova bozza ferma i promemoria in attesa e dovrai riattivarla.",
    },
    {
      target: "notifications-activate",
      title: "3. Attiva",
      body: "Scegli le autorizzazioni create in Collegamento Connect e premi «Attiva per le nuove prenotazioni». Da qui puoi anche fermare i promemoria ancora da inviare.",
    },
    {
      target: "notifications-simulate",
      title: "Prova gli orari",
      body: "Scegli un'attività e un appuntamento di esempio per vedere quando partirebbero i messaggi e come appaiono. Non invia nulla.",
    },
    {
      target: "tab-templates",
      title: "Testi dei messaggi",
      body: "Qui personalizzi i testi di email e notifiche nell'app per ogni evento, con un'anteprima su dati di esempio. I testi WhatsApp restano nei promemoria.",
    },
    {
      target: "tab-activity",
      title: "Risposte e prossimi invii",
      body: "Controlla gli esiti delle ultime prenotazioni e le richieste dei clienti da gestire, come le modifiche: quando le hai risolte, segnale come gestite.",
    },
  ],
};
