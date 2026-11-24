import type { TourDefinition } from "../tour.types";

/**
 * Tour of "Promemoria e notifiche". Follows the guided steps of
 * «Promemoria automatici»: each step opens only when the one before is done,
 * so the tour explains the order instead of pointing at locked fields.
 */
export const NOTIFICATIONS_TOUR: TourDefinition = {
  id: "notifications",
  navKey: "notifications",
  title: "Promemoria e notifiche",
  version: 3,
  // Same rule as the menu entry (companyFunction("notifications.manage")).
  when: (ctx) => ctx.can("notifications.manage"),
  steps: () => [
    {
      title: "Promemoria e notifiche",
      body: "Qui ALORA ricorda gli appuntamenti ai clienti su WhatsApp e, se vuoi, chiede loro di confermare. Ci sono 6 passi in ordine: ognuno si apre quando hai finito quello prima.",
    },
    {
      target: "notifications-status",
      tab: "rules",
      title: "Attivi o no",
      body: "Qui vedi subito se i promemoria stanno partendo. Valgono per le prenotazioni nuove o modificate: quelle già presenti non ricevono messaggi arretrati.",
    },
    {
      target: "notifications-step-number",
      tab: "rules",
      title: "1. Il tuo numero",
      body: "I messaggi partono dal numero WhatsApp collegato ad ALORA. Se non è collegato, il pulsante ti porta a «Messaggi WhatsApp» per inquadrare il QR.",
    },
    {
      target: "notifications-step-permission",
      tab: "rules",
      title: "2. Il permesso di scrivere",
      body: "Un tocco su «Consenti l'invio» e ALORA può scrivere ai clienti che hanno dato il consenso WhatsApp. Puoi revocarlo quando vuoi dalla scheda «Permessi».",
    },
    {
      target: "notifications-options",
      tab: "rules",
      title: "3. Quali messaggi",
      body: "Scegli se mandare un riepilogo subito dopo la prenotazione, quanti promemoria e quanto prima, e se avvisare quando l'appuntamento viene confermato, annullato o spostato. Il testo compare solo per i messaggi che scegli.",
    },
    {
      target: "notifications-step-replies",
      tab: "rules",
      title: "4. Conferma del cliente",
      body: "Facoltativo. Il messaggio avrà i pulsanti Confermo, Richiedi modifica, Annulla: la risposta aggiorna l'agenda da sola. ALORA ti elenca cosa attivare, con un pulsante per ciascuna cosa.",
    },
    {
      target: "notifications-step-hours",
      tab: "rules",
      title: "5. In che orari",
      body: "ALORA scrive solo in questa fascia e quando la sede è aperta. Con «Prova con un appuntamento di esempio» vedi quando partirebbero, senza inviare nulla.",
    },
    {
      target: "notifications-activate",
      tab: "rules",
      title: "6. Attiva",
      body: "«Salva e attiva» applica tutto. Se manca qualcosa, il passo ti dice cosa e in quale passo. Da qui puoi anche fermare i promemoria.",
    },
    {
      target: "tab-activity",
      title: "Risposte e prossimi invii",
      body: "Qui trovi le risposte dei clienti e le richieste da gestire, come le modifiche: quando le hai risolte, segnale come gestite.",
    },
    {
      target: "tab-templates",
      title: "Avvisi email e app",
      body: "I testi delle email e degli avvisi nell'app per lo staff. I testi WhatsApp sono nei passi dei promemoria.",
    },
  ],
};
