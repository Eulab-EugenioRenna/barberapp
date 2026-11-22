import type { TourDefinition } from "../tour.types";

/**
 * Tour of "Profilo e prenotazioni". The view requires settings.manage, so every
 * control on the page is usable by whoever can open it.
 */
export const SETTINGS_TOUR: TourDefinition = {
  id: "settings",
  navKey: "settings",
  title: "Profilo e prenotazioni",
  version: 1,
  when: (ctx) => ctx.canView("settings"),
  steps: () => [
    {
      title: "Profilo e prenotazioni",
      body: "Qui definisci come si presenta la tua attività ai clienti: nome, logo, colori, testi e regole della pagina di prenotazione online.",
    },
    {
      target: "settings-preview",
      title: "Anteprima per i clienti",
      body: "Mostra in tempo reale come apparirà la pagina di prenotazione mentre modifichi i campi. È solo un'anteprima: nulla cambia finché non salvi.",
    },
    {
      target: "settings-name",
      title: "Nome dell'attività",
      body: "Il nome del salone è obbligatorio: senza non puoi salvare.",
    },
    {
      target: "settings-domain",
      title: "Indirizzo della pagina clienti",
      body: "Se hai un tuo dominio (es. booking.miodominio.it) inseriscilo qui; altrimenti la pagina usa l'indirizzo standard dell'attività. Il link sotto apre la pagina clienti.",
    },
    {
      target: ["settings-logo", "settings-cover"],
      title: "Logo e copertina",
      body: "Scegli un'immagine e premi «Carica» per pubblicarla subito; con «Rimuovi» la togli. Se salvi le impostazioni con un file scelto ma non caricato, viene caricato in automatico.",
    },
    {
      target: "settings-colors",
      title: "Colori",
      body: "Il colore principale e quello in evidenza personalizzano la pagina di prenotazione.",
    },
    {
      target: "settings-booking-mode",
      title: "Come accetti le prenotazioni",
      body: "Scegli solo online, online e dal salone, oppure solo dal salone, e il titolo che i clienti vedono in cima alla pagina.",
    },
    {
      target: "settings-public-texts",
      title: "Testi della pagina",
      body: "Il messaggio di benvenuto e, sotto, i passaggi della prenotazione: una riga per passaggio nel formato Titolo|Descrizione.",
    },
    {
      target: "settings-holidays",
      title: "Chiusure del salone",
      body: "Aggiungi i giorni di chiusura con data e nome: in quei giorni nessun professionista risulta disponibile.",
    },
    {
      target: "settings-public-enabled",
      title: "Prenotazioni online",
      body: (c) =>
        (c.tenant?.publicEnabled === false
          ? "Ora i clienti non possono prenotare dal link pubblico. "
          : "") + "Con questa opzione decidi se i clienti possono inviare prenotazioni dal link pubblico.",
    },
    {
      target: "settings-ui-scale",
      title: "Scala dell'interfaccia",
      body: "Ingrandisce o riduce testi e controlli del gestionale solo su questo dispositivo e si applica subito, senza salvare.",
    },
    {
      target: "settings-save",
      title: "Salva impostazioni",
      body: "Pubblica tutte le modifiche: nome, indirizzo, colori, testi, chiusure e prenotazioni online.",
    },
    {
      target: "settings-reset",
      title: "Ripristina i valori consigliati",
      body: "Riporta colori, modalità di prenotazione e testi ai valori consigliati e svuota logo, copertina e chiusure nel modulo. Diventa definitivo solo quando premi «Salva impostazioni».",
    },
  ],
};
