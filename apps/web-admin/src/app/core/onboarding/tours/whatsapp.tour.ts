import type { TourDefinition } from "../tour.types";

/** Guide of the WhatsApp page: link, conversations, sending and outbox. */
export const WHATSAPP_TOUR: TourDefinition = {
  id: "whatsapp",
  navKey: "whatsapp",
  title: "Messaggi WhatsApp",
  version: 3,
  when: (ctx) => ctx.canView("whatsapp"),
  steps: (ctx) => [
    {
      title: "Il tuo WhatsApp in ALORA",
      body:
        "Colleghi il tuo numero, leggi le conversazioni" +
        (ctx.can("whatsapp.send") ? " e invii messaggi" : "") +
        ". Il collegamento appartiene al tuo account e lo stato si aggiorna da solo ogni pochi secondi.",
    },
    {
      target: "whatsapp-status",
      tab: "connection",
      title: "Stato del collegamento",
      body: "Qui vedi il numero collegato e il suo stato (Connesso, Da collegare, Interrotto…), con i messaggi già acquisiti nella cronologia.",
    },
    {
      target: "whatsapp-actions",
      tab: "connection",
      title: "Collega e gestisci il numero",
      body:
        "«Collega il tuo numero» mostra un QR da inquadrare dal telefono in Dispositivi collegati. " +
        "«Riconnetti» riprende un collegamento interrotto; «Disconnetti» lo ferma conservando lo storico, «Elimina collegamento» lo rimuove per crearne uno nuovo.",
      when: (c) => c.can("whatsapp.manage"),
    },
    {
      target: "whatsapp-qr",
      tab: "connection",
      title: "Inquadra il QR",
      body: "Apri WhatsApp sul telefono, vai in Dispositivi collegati › Collega un dispositivo e inquadra il codice: si rinnova da solo finché il numero non è collegato.",
      when: (c) => c.can("whatsapp.manage"),
    },
    {
      target: "tab-chats",
      title: "Conversazioni",
      body:
        "Scegli una chat per leggerne i messaggi e caricare quelli precedenti." +
        (ctx.can("whatsapp.send") ? " Scegliendo una chat puoi risponderle da «Nuovo messaggio»." : ""),
    },
    {
      target: "tab-compose",
      title: "Nuovo messaggio",
      body: "Cerca il cliente per nome (compaiono solo quelli con telefono) oppure rispondi alla conversazione scelta, scrivi il testo e conferma il consenso. Si invia solo con il numero connesso. Per scrivere a tutti usa «Messaggio a tutti» in Clienti.",
      when: (c) => c.can("whatsapp.send"),
    },
    {
      target: "tab-outbox",
      title: "Invii",
      body: "Lo stato di ogni invio dal tuo numero. Ogni «Messaggio a tutti» è una riga sola: aprila per vedere i passaggi, se è in esecuzione o completato e ogni destinatario. " +
        "Anche i messaggi singoli si aprono nel dettaglio. «Inviato al canale» non significa letto; gli esiti da verificare non vengono mai reinviati in automatico.",
    },
    {
      target: "whatsapp-refresh",
      title: "Aggiorna",
      body: "Forza subito l'aggiornamento di stato, conversazioni e invii senza attendere quello automatico.",
    },
  ],
};
