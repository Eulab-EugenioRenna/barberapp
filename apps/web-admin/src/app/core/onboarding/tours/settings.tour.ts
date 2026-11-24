import type { TourDefinition } from "../tour.types";

/**
 * Tour of "Profilo e prenotazioni". The view requires settings.manage, so every
 * control on the page is usable by whoever can open it.
 */
export const SETTINGS_TOUR: TourDefinition = {
  id: "settings",
  navKey: "settings",
  title: "Profilo e prenotazioni",
  version: 2,
  when: (ctx) => ctx.canView("settings"),
  steps: () => [
    {
      title: "Profilo e prenotazioni",
      body: "Qui decidi come si presenta il salone e se i clienti possono prenotare da soli. Le impostazioni compaiono in ordine: quelle della pagina online solo se le prenotazioni online sono attive.",
    },
    {
      target: "settings-preview",
      title: "Anteprima per i clienti",
      body: "Mostra come apparirà la pagina di prenotazione mentre modifichi. Nulla cambia finché non salvi.",
    },
    {
      target: "settings-name",
      title: "1. Nome del salone",
      body: "Obbligatorio: lo vedono i clienti nella pagina e nei messaggi.",
    },
    {
      target: "settings-booking-mode",
      title: "2. Come accetti le prenotazioni",
      body: "La scelta più importante. «Solo dal salone» nasconde tutto ciò che riguarda la pagina online; le altre due mostrano le impostazioni della pagina.",
    },
    {
      target: "settings-public-enabled",
      title: "Sospendere le prenotazioni online",
      body: (c) =>
        (c.tenant?.publicEnabled === false ? "Ora le prenotazioni online sono sospese. " : "") +
        "Un interruttore per fermarle e riaprirle al volo, senza perdere le altre impostazioni.",
    },
    {
      target: "settings-domain",
      title: "3. La tua pagina",
      body: "Facoltativo: se hai un tuo dominio inseriscilo, altrimenti si usa l'indirizzo ALORA. Sotto, titolo, benvenuto e passaggi che i clienti leggono.",
    },
    {
      target: ["settings-logo", "settings-cover"],
      title: "4. Logo e copertina",
      body: "Scegli un'immagine e premi «Carica». Se salvi con un file scelto ma non caricato, viene caricato in automatico.",
    },
    {
      target: "settings-colors",
      title: "Colori",
      body: "Personalizzano la pagina di prenotazione.",
    },
    {
      target: "settings-holidays",
      title: "5. Chiusure di tutte le sedi",
      body: "Giorni in cui nessuno è prenotabile in nessuna sede. Le chiusure di una sola sede si impostano in Sedi.",
    },
    {
      target: "settings-save",
      title: "Salva",
      body: "Pubblica tutte le modifiche.",
    },
    {
      target: "settings-ui-scale",
      title: "Preferenze di questo dispositivo",
      body: "In fondo, chiuse: la dimensione dei testi vale solo su questo dispositivo e si applica subito.",
    },
  ],
};
