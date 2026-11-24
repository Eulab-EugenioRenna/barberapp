import type { TourDefinition } from "../tour.types";

const canUpdateStatus = (ctx: { can: (key: string) => boolean }) =>
  ctx.can("appointments.update.own") || ctx.can("appointments.update.all");

/** Personal agenda of a collaborator: own period, schedule and assigned appointments. */
export const MY_AGENDA_TOUR: TourDefinition = {
  id: "my-agenda",
  navKey: "my-agenda",
  title: "La mia agenda",
  version: 2,
  when: (ctx) =>
    ctx.role !== "platform_admin" &&
    !!ctx.user?.collaboratorId &&
    ctx.can("appointments.read.own"),
  steps: () => [
    {
      title: (ctx) => (ctx.firstName ? `${ctx.firstName}, ecco la tua agenda` : "La tua agenda"),
      body:
        "Qui trovi solo il tuo lavoro: gli appuntamenti assegnati a te, i tuoi turni e il riepilogo del periodo. " +
        "Ti mostro come leggerla e cosa puoi fare.",
    },
    {
      target: "my-agenda-new",
      when: canUpdateStatus,
      title: "Segna un tuo appuntamento",
      body:
        "Con «Nuovo appuntamento» prenoti nella tua agenda: scegli il cliente (o inseriscilo se è nuovo), " +
        "il servizio e il giorno, poi uno degli orari liberi che ALORA ti propone.",
    },
    {
      target: "my-agenda-back",
      when: (ctx) => ctx.can("appointments.read.all") || ctx.can("users.manage"),
      title: "Agenda di un collega",
      body: "Stai guardando l'agenda di un altro professionista: con «Torna alla squadra» rientri nell'elenco.",
    },
    {
      target: "my-agenda-period",
      title: "Scegli il periodo",
      body:
        "Seleziona giorno, settimana o mese e la data di riferimento, poi premi «Mostra»: " +
        "contatori, eccezioni d'orario e appuntamenti si aggiornano sul periodo scelto.",
    },
    {
      target: "my-agenda-today",
      title: "Torna a oggi",
      body: "Riporta la data di riferimento a oggi e ricarica la prima pagina degli appuntamenti.",
    },
    {
      target: "my-agenda-refresh",
      title: "Aggiorna",
      body:
        "Ricarica i dati senza cambiare periodo: utile se il salone ha appena spostato o aggiunto un tuo appuntamento.",
    },
    {
      target: "my-agenda-stats",
      title: "Riepilogo del periodo",
      body:
        "Appuntamenti totali, completati, servizi attribuiti a te nei conti registrati, assenze e annullati del periodo.",
    },
    {
      target: "my-agenda-values",
      when: (ctx) => ctx.can("dashboard.personal.values.read"),
      title: "Valore dei tuoi servizi",
      body:
        "Somma delle righe dei conti confermati in cui risulti come collaboratore, con imposte e sconti. " +
        "Non è un incasso né un compenso.",
    },
    {
      target: "my-agenda-schedule",
      title: "I tuoi orari",
      body:
        "La settimana tipo e le eccezioni (ferie, chiusure del salone) le configura il salone: " +
        "se qualcosa non torna chiedi al titolare o al responsabile.",
    },
    {
      target: "my-agenda-appointments",
      title: "Appuntamenti assegnati",
      body:
        "L'elenco dei tuoi appuntamenti nel periodo, con orario, servizio, cliente e note. " +
        "Se sono molti usa «Precedenti» e «Successivi» in fondo.",
    },
    {
      target: "my-agenda-status-actions",
      when: canUpdateStatus,
      title: "Aggiorna lo stato",
      body:
        "Conferma la prenotazione, segna l'arrivo, completa il servizio o segna l'assenza. " +
        "Ogni cambio ti chiede una conferma prima di essere salvato.",
      fallback:
        "Quando hai appuntamenti da gestire, sotto ognuno trovi i pulsanti per confermarlo, segnare l'arrivo, " +
        "completare il servizio o segnare l'assenza. Ogni cambio chiede una conferma.",
    },
    {
      title: "Pronto per lavorare",
      body: (ctx) =>
        canUpdateStatus(ctx)
          ? "Tieni aggiornati gli stati durante la giornata: il salone vede subito chi è arrivato e chi ha finito."
          : "Puoi consultare l'agenda in ogni momento; per modificare un appuntamento rivolgiti al salone.",
    },
  ],
};
