import type { TourDefinition } from "../tour.types";

/** Agenda: create → filter → move in time → read → act on an appointment. */
export const APPOINTMENTS_TOUR: TourDefinition = {
  id: "appointments",
  navKey: "appointments",
  title: "Agenda",
  version: 5,
  when: (ctx) => ctx.canView("appointments"),
  steps: () => [
    {
      title: "L'agenda del salone",
      body: (c) =>
        "Qui trovi gli appuntamenti di tutta la squadra, per giorno, settimana o mese." +
        (c.can("appointments.update.all")
          ? " Puoi crearli, spostarli e chiuderne il conto."
          : " Puoi consultarli e aprirne i dettagli."),
    },
    {
      target: "header-new",
      title: "Nuovo",
      body: (c) =>
        [
          c.can("sales.manage") && "«Vendi adesso» apre la cassa: prodotti soli, servizi soli o entrambi. I servizi finiscono in agenda, anche con un orario passato.",
          c.can("appointments.create") && "«Prenota» fissa un appuntamento futuro controllando orari e disponibilità; con più sedi scegli prima la sede e vedi solo i servizi delle attività svolte lì. Gli orari di apertura valgono per le prenotazioni online: qui puoi scegliere anche un orario del gruppo «Fuori orario». Il conto lo chiudi poi in Cassa.",
        ]
          .filter(Boolean)
          .join(" "),
      when: (c) => c.can("sales.manage") || c.can("appointments.create"),
    },
    {
      target: "appointments-tabs",
      title: "Calendario o lista",
      body: "«Calendario» mostra la griglia oraria; «Lista appuntamenti» li elenca tutti in ordine di orario.",
    },
    {
      target: "appointments-team",
      title: "Filtra la squadra",
      body: "Scegli uno o più professionisti per vedere solo le loro colonne e i loro appuntamenti, sia nel calendario sia nella lista.",
    },
    {
      target: "appointments-date-nav",
      tab: "calendar",
      title: "Muoviti nel tempo",
      body: "Vai a una data precisa dal calendario, torna a «Oggi» o scorri con «Indietro» e «Avanti».",
    },
    {
      target: "appointments-views",
      tab: "calendar",
      title: "Giorno, settimana, mese",
      body:
        "Cambia l'ampiezza del calendario. In settimana e mese fai doppio clic su un giorno per aprirlo, " +
        "oppure tocca «+N altri» per vederne la lista completa.",
    },
    {
      target: "appointments-summary",
      tab: "calendar",
      title: "Riepilogo del periodo",
      body: "Quanti appuntamenti ci sono, quanti confermati e completati e il valore previsto, per il periodo visualizzato.",
    },
    {
      target: "appointments-grid",
      tab: "calendar",
      title: "Gli appuntamenti",
      body: (c) =>
        c.can("sales.manage")
          ? "Tocca un appuntamento per l'anteprima: da lì apri i dettagli, lo modifichi o usi «Chiudi il conto» per incassarlo."
          : "Tocca un appuntamento per l'anteprima e i dettagli completi.",
    },
    {
      target: "appointments-grid",
      tab: "calendar",
      title: "Spostare un appuntamento",
      body:
        "Trascina un appuntamento: nella vista giorno lo sposti direttamente su un altro orario o professionista; " +
        "in settimana e mese si apre una finestra per scegliere orario e professionista.",
      when: (c) => c.can("appointments.update.all"),
    },
    {
      target: "appointments-list",
      tab: "list",
      title: "Lista appuntamenti",
      body: (c) =>
        c.can("appointments.update.all")
          ? "Tocca una riga per aprire la prenotazione: puoi modificarla, annullarla o eliminarla" +
            (c.can("sales.manage") ? " e chiuderne il conto." : ".")
          : "Tocca una riga per vedere i dettagli dell'appuntamento.",
    },
    {
      target: "header-refresh",
      title: "Aggiorna",
      body: "Ricarica l'agenda con le ultime prenotazioni e modifiche.",
    },
  ],
};
