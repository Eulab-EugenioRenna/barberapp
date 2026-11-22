import type { TourDefinition } from "../tour.types";

/** Platform administration: client companies, backups, plans and subscriptions. */
export const PLATFORM_TOUR: TourDefinition = {
  id: "platform",
  navKey: "platform",
  title: "Gestione aziende",
  version: 1,
  when: (ctx) => ctx.role === "platform_admin",
  steps: () => [
    {
      title: (ctx) => (ctx.firstName ? `Ciao ${ctx.firstName}` : "Gestione aziende"),
      body:
        "Da qui amministri le attività clienti della piattaforma: dati, accesso, copie di sicurezza, piani e abbonamenti. " +
        "Quasi tutte le operazioni valgono per l'attività selezionata.",
    },
    {
      target: "platform-tenants",
      title: "Scegli un'attività",
      body:
        "Tocca un'attività dell'elenco per selezionarla: si compila la scheda a fianco e si carica il controllo dei suoi contenuti.",
      fallback: "Quando ci sono attività clienti le trovi elencate qui: selezionane una per gestirla.",
    },
    {
      target: "platform-tenant-panel",
      title: "Dati dell'attività",
      body:
        "Nome, identificativo web, indirizzo delle prenotazioni, note, prenotazioni online e modalità di prenotazione. " +
        "«Salva attività» applica le modifiche.",
    },
    {
      target: "platform-tenant-actions",
      title: "Accesso e dati",
      body:
        "«Sospendi» e «Riattiva» bloccano o riaprono l'attività. «Svuota dati attività» cancella i suoi dati operativi " +
        "senza chiedere conferma: prepara prima una copia. «Elimina attività» chiede conferma.",
      fallback:
        "Dopo aver selezionato un'attività compaiono qui i pulsanti per salvarla, sospenderla, riattivarla, " +
        "svuotarne i dati o eliminarla.",
    },
    {
      target: "platform-backup-actions",
      title: "Copia di sicurezza",
      body:
        "«Prepara copia» mette i dati dell'attività nei riquadri sotto, da copiare e conservare. " +
        "«Ripristina» sostituisce i dati attuali con quelli incollati nel riquadro di ripristino.",
    },
    {
      target: "platform-health",
      title: "Controllo dati",
      body: "Conteggio di utenti, professionisti, clienti, appuntamenti e vendite: verifica qui l'esito di un ripristino o di uno svuotamento.",
    },
    {
      target: "platform-plan-new",
      title: "Piani",
      body:
        "Tocca un piano dell'elenco per modificarlo, oppure «Nuovo piano» per svuotare il modulo e crearne uno.",
    },
    {
      target: "platform-plan-form",
      title: "Dettagli del piano",
      body: "Codice, nome, prezzo e frequenza di fatturazione. Codice e nome sono obbligatori.",
    },
    {
      target: "platform-subscription-form",
      title: "Assegna un piano",
      body:
        "Scegli piano e stato dell'abbonamento e premi «Assegna piano»: vale per l'attività selezionata e compare tra i piani assegnati.",
    },
  ],
};
