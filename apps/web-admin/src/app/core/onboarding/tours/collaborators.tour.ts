import type { TourContext, TourDefinition, TourStep } from "../tour.types";

// Mirrors AdminCollaboratorsPageComponent.canManageAccounts: with users.manage the
// page shows the team & access view, otherwise the plain professionals list.
const managesAccounts = (ctx: TourContext) => ctx.can("users.manage");
// Mirrors AdminTeamPageComponent.canEditProfiles.
const editsProfiles = (ctx: TourContext) =>
  ctx.can("collaborators.manage") && ctx.can("collaborators.read");
// Mirrors AdminTeamPageComponent.canManage (the server must also allow it).
const managesTeam = (ctx: TourContext) => ctx.can("team.manage");

const PROFILE_FORM =
  "Si apre la scheda del professionista: nome, contatti, colore in agenda, prenotabilità online, orario settimanale ed eccezioni giornaliere (ferie, festivi, orari diversi).";

function teamSteps(ctx: TourContext): TourStep[] {
  return [
    {
      title: "Squadra e accessi",
      body:
        ctx.role === "owner"
          ? "Qui gestisci le persone del salone: profili di lavoro con orari, ruoli e accessi al gestionale. Una persona può lavorare in salone anche senza account."
          : "Qui trovi le persone del salone, i loro profili di lavoro e gli accessi al gestionale che puoi gestire con il tuo ruolo.",
    },
    {
      target: "collaborators-new",
      title: "Aggiungi collaboratore",
      body: PROFILE_FORM + " Non crea un accesso al gestionale.",
      when: editsProfiles,
    },
    {
      target: "collaborators-search",
      title: "Cerca una persona",
      body: "Filtra la squadra per nome e cognome. «Aggiorna» ricarica persone, ruoli e accessi dal server.",
    },
    {
      target: "collaborators-card",
      title: "La scheda della persona",
      body: (c) => {
        const actions: string[] = [];
        if (editsProfiles(c)) actions.push("modifichi profilo, servizi e orari");
        if (managesTeam(c)) actions.push("attivi l'accesso, cambi ruolo o lo revochi");
        if (managesTeam(c) && c.can("team.password.reset")) actions.push("avvii il recupero password");
        return (
          "Ogni scheda mostra il ruolo e lo stato dell'accesso. Toccala per aprire i dettagli" +
          (actions.length ? ": da lì " + actions.join(", ") + "." : ".")
        );
      },
      fallback: "La squadra è ancora vuota: aggiungi il primo collaboratore.",
    },
    {
      target: "collaborators-agenda",
      title: "Agenda della persona",
      body: "Apre direttamente l'agenda del professionista con i suoi appuntamenti.",
      when: (c) => c.can("appointments.read.all") || c.can("appointments.read.own"),
    },
    {
      target: "collaborators-access",
      title: "Crea un accesso",
      body:
        "«Nuovo accesso» in tre passaggi: 1 · Persona (nome, cognome, email), 2 · Ruolo (tocca una scheda; il profilo professionista, se serve, anche sotto «Avanzate»), 3 · Conferma. " +
        "La password iniziale viene generata per te: consegnala alla persona, al primo accesso ne sceglierà una nuova.",
      when: managesTeam,
    },
    {
      target: "collaborators-roles",
      title: "Gestisci ruoli",
      body: "Oltre ai ruoli predefiniti Titolare e Collaboratore puoi creare ruoli personalizzati scegliendo le funzioni che includono. Il ruolo Collaboratore vede solo la propria agenda.",
      when: managesTeam,
    },
    {
      target: "collaborators-pending",
      title: "Creazioni da completare",
      body: "Account rimasti a metà: usa «Riprendi creazione» per completarli senza creare un secondo account.",
      when: managesTeam,
    },
  ];
}

function listSteps(): TourStep[] {
  return [
    {
      title: "La tua squadra",
      body: "Qui trovi i professionisti del salone, con chi è prenotabile online e chi lavora solo internamente.",
    },
    {
      target: "collaborators-new",
      title: "Nuovo collaboratore",
      body: PROFILE_FORM,
      when: (c) => c.can("collaborators.manage"),
    },
    {
      target: "collaborators-search",
      title: "Cerca nella squadra",
      body: "Filtra per nome, email o telefono.",
    },
    {
      target: "collaborators-card",
      title: "Apri un professionista",
      body: (c) =>
        c.can("collaborators.manage")
          ? "Tocca un professionista per modificarne profilo e orari o eliminarlo" +
            (c.can("settings.manage") ? ", oppure impostarlo come riferimento." : ".") +
            " Il bollino «riferimento» indica il professionista proposto di default."
          : "Tocca un professionista per vederne profilo e orari. Il bollino «riferimento» indica il professionista proposto di default.",
      fallback: "La squadra è ancora vuota.",
    },
  ];
}

/** Tour of "Squadra e accessi": people, working profiles, roles and access. */
export const COLLABORATORS_TOUR: TourDefinition = {
  id: "collaborators",
  navKey: "collaborators",
  title: "Squadra e accessi",
  // v2: «Nuovo accesso» in three steps.
  version: 2,
  when: (ctx) => ctx.canView("collaborators"),
  steps: (ctx) => (managesAccounts(ctx) ? teamSteps(ctx) : listSteps()),
};
