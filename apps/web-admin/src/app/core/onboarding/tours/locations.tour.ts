import type { TourDefinition } from "../tour.types";

const canEdit = (ctx: { can: (key: string) => boolean }) => ctx.can("locations.manage");
// Mirrors LocationsComponent.canManageVisibility.
const canManageVisibility = (ctx: { can: (key: string) => boolean }) =>
  ctx.can("locations.manage") && ctx.can("users.manage") && ctx.can("team.manage");

/** Tour of "Sedi e attività": structure, resources and who works where. */
export const LOCATIONS_TOUR: TourDefinition = {
  id: "locations",
  navKey: "locations",
  title: "Sedi e attività",
  version: 2,
  when: (ctx) => ctx.canView("locations"),
  steps: (ctx) => [
    {
      title: "Sedi e attività",
      body: canEdit(ctx)
        ? "Qui organizzi l'azienda. Le attività (Barberia, Estetica, Rivendita…) sono ciò che fai e valgono per tutto l'account; ogni sede ne svolge una o più, con orari, professionisti e risorse propri. Servizi e prodotti appartengono a un'attività: in agenda e in cassa, in ogni sede compaiono solo quelli delle attività presenti lì."
        : "Qui consulti le sedi, le attività di ciascuna e chi ci lavora. Per modificarle serve il permesso di gestione delle sedi.",
    },
    {
      target: "tab-activities",
      title: "Catalogo attività",
      body: "Parti da qui: aggiungi con un tocco le attività del catalogo (Barberia, Parrucchiere, Estetica, Unghie, Benessere e spa, Rivendita) o creane di tue. Puoi rinominarle e disattivarle: il nome cambia in tutte le sedi.",
      when: canEdit,
    },
    {
      target: "locations-create",
      title: "Nuova sede",
      body: "Apre il modulo per creare una sede: inserisci nome e indirizzo e spunta le attività che vi si svolgono.",
      when: canEdit,
    },
    {
      target: "locations-card",
      title: "La scheda della sede",
      body: "Ogni scheda mostra se la sede è attiva, se è visibile nelle prenotazioni online e, sotto, le sue attività con i professionisti assegnati e le risorse.",
      fallback: "Non ci sono ancora sedi: crea la prima con il modulo «Nuova sede».",
    },
    {
      target: "locations-configure",
      title: "Configura sede",
      body: "Apre la configurazione: nome, indirizzo, sede attiva o disattivata, visibilità online, orari di apertura settimanali e giorni di chiusura. Disattivando una sede impedisci nuove prenotazioni, lo storico resta.",
      when: canEdit,
    },
    {
      target: "locations-sector-configure",
      title: "Configura attività",
      body: "Impostazioni dell'attività in questa sede: può usare gli orari della sede oppure averne di propri, ed essere visibile online o solo interna. Il nome si cambia dal catalogo.",
      when: canEdit,
    },
    {
      target: "locations-resource-add",
      title: "Aggiungi una risorsa",
      body: "Crea una postazione, poltrona o cabina dell'attività indicando nome e capienza (quante persone serve in contemporanea, 1 se non indicata).",
      when: canEdit,
    },
    {
      target: "locations-resource-controls",
      title: "Gestisci le risorse",
      body: "Per ogni risorsa puoi cambiare la capienza e salvarla, disattivarla o riattivarla, e scegliere se è prenotabile online o solo internamente.",
      when: canEdit,
    },
    {
      target: "locations-sector-add",
      title: "Aggiungi un'attività alla sede",
      body: "Scegli dal catalogo un'attività che questa sede non svolge ancora, per esempio «Estetica» accanto a «Barberia»: i suoi servizi diventano prenotabili e vendibili anche qui.",
      when: canEdit,
    },
    {
      target: "tab-people",
      title: "Chi lavora dove",
      body: "In questa sezione scegli in quali sedi e attività lavora ogni professionista e salvi le appartenenze: i suoi orari si incrociano con le aperture dei luoghi selezionati.",
      when: canEdit,
    },
    {
      target: "tab-visibility",
      title: "Visibilità per ruolo",
      body: "Qui indichi quali attività possono consultare manager e reception. Non aggiunge funzioni: cambia solo le sedi e attività su cui lavorano.",
      when: canManageVisibility,
    },
  ],
};
