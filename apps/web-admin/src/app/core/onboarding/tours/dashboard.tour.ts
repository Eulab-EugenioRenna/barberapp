import type { TourDefinition } from "../tour.types";

/** Panoramica: filters → figures → detail lists → shortcuts in the header. */
export const DASHBOARD_TOUR: TourDefinition = {
  id: "dashboard",
  navKey: "dashboard",
  title: "Panoramica",
  version: 2,
  when: (ctx) => ctx.canView("dashboard"),
  steps: () => [
    {
      title: "Panoramica dell'attività",
      body: (c) =>
        "Qui vedi venduto, incassi, conti del periodo e prossimi appuntamenti." +
        (c.role === "owner"
          ? " Come titolare vedi i numeri di tutte le sedi."
          : " Vedi solo i conti interamente compresi nelle sedi e attività che ti sono assegnate."),
    },
    {
      target: "dashboard-filters",
      title: "Scegli cosa analizzare",
      body:
        "Imposta periodo (giorno, settimana, mese, anno o tutto), data di riferimento, cliente e professionista: " +
        "i numeri si aggiornano appena cambi un filtro.",
    },
    {
      target: "dashboard-reset",
      title: "Azzera filtri",
      body: "Riporta la panoramica alla giornata di oggi, per tutti i clienti e tutta la squadra.",
    },
    {
      target: "dashboard-balance",
      title: "Nascondi gli importi",
      body:
        "Copre tutti gli importi con asterischi, utile se lo schermo è visibile ai clienti. " +
        "La scelta resta memorizzata su questo dispositivo.",
    },
    {
      target: "dashboard-metrics",
      title: "I numeri del periodo",
      body:
        "Venduto, incassi e residui del periodo scelto. Il venduto segue la data del conto confermato, " +
        "gli incassi la data del pagamento.",
    },
    {
      target: "dashboard-activity",
      title: "Conti del periodo",
      body:
        "L'elenco delle vendite e degli appuntamenti con conto nel periodo, con importo e stato. " +
        "Scorri in fondo per caricarne altri.",
    },
    {
      target: "dashboard-breakdown",
      title: "Chi ha generato il venduto",
      body: "Il venduto suddiviso per cliente e i servizi per professionista che li ha eseguiti; più in basso trovi anche sede e attività.",
    },
    {
      target: "dashboard-upcoming",
      title: "Prossimi appuntamenti",
      body: (c) =>
        c.can("appointments.update.all")
          ? "Gli appuntamenti futuri richiesti o confermati. Tocca una riga per aprire la prenotazione e modificarla."
          : "Gli appuntamenti futuri richiesti o confermati, in ordine di orario.",
    },
    {
      target: "dashboard-accounts",
      title: "Situazione dei conti",
      body: "Totale dei conti del periodo, quanto è già stato incassato e il residuo ancora da ricevere.",
    },
    {
      target: "header-new",
      title: "Nuovo",
      body: (c) =>
        [
          c.can("sales.manage") && "«Vendi adesso» apre la cassa: prodotti soli, servizi soli o entrambi. I servizi finiscono in agenda, anche con un orario passato.",
          c.can("appointments.create") && "«Prenota» fissa un appuntamento futuro controllando orari e disponibilità; il conto lo chiudi poi in Cassa.",
        ]
          .filter(Boolean)
          .join(" "),
      when: (c) => c.can("sales.manage") || c.can("appointments.create"),
    },
    {
      target: "header-refresh",
      title: "Aggiorna",
      body: "Ricarica i dati e riporta la data di riferimento a oggi.",
    },
  ],
};
