import type { TourDefinition } from "../tour.types";

/** Personal account: SSO profile, protection, sessions, devices, notices and guide preferences. */
export const ACCOUNT_TOUR: TourDefinition = {
  id: "account",
  navKey: "account",
  title: "Il mio account",
  version: 2,
  when: (ctx) => !!ctx.user && ctx.role !== "platform_admin" && !ctx.user.technicalAccess,
  steps: () => [
    {
      title: "Il tuo account",
      body:
        "Qui controlli il tuo accesso personale: profilo, sicurezza, sessioni aperte e dispositivi. " +
        "Tutto si gestisce da qui, senza uscire da ALORA; le modifiche riguardano solo te.",
    },
    {
      target: "account-profile",
      title: "I tuoi dati",
      body:
        "Modifica nome e cognome e premi «Salva profilo»: il nome cambia in ALORA e in tutte le app EULAB. " +
        "L'email è la tua identità di accesso e resta fissa.",
    },
    {
      target: "account-password",
      title: "Cambia password",
      body:
        "Apre solo la schermata sicura di EULAB per scegliere la nuova password, poi torni qui da solo. " +
        "La password non passa mai da ALORA.",
    },
    {
      target: "account-authenticators",
      title: "App di autenticazione",
      body:
        "Configura un'app sul telefono (Google Authenticator, Microsoft Authenticator…) per chiedere un codice a ogni accesso. " +
        "Vedi le app collegate e puoi rimuoverle: per sicurezza la rimozione chiude tutte le sessioni.",
    },
    {
      target: "account-mfa-method",
      title: "Metodo di verifica",
      body: "Scegli se ricevere il codice dall'app o via email. «Automatico» usa quello disponibile.",
    },
    {
      target: "account-email",
      title: "Verifica email",
      body: "Se l'email non è verificata compare «Verifica email»: serve per i codici di accesso e il recupero password.",
    },
    {
      target: "account-sessions",
      title: "Le mie sessioni",
      body:
        "Gli accessi aperti con il tuo account e l'ultima attività. «Disconnetti» chiude quella sessione, " +
        "anche nelle altre applicazioni EULAB collegate, dopo una conferma.",
    },
    {
      target: "account-logout-all",
      title: "Disconnetti tutte",
      body:
        "Chiude tutte le tue sessioni, compresa questa: dovrai accedere di nuovo. " +
        "Usalo se pensi che qualcuno abbia usato il tuo account.",
    },
    {
      target: "account-devices",
      title: "Dispositivi attendibili",
      body:
        "I browser riconosciuti. «Revoca dispositivo» toglie lo stato attendibile, chiude le sessioni " +
        "e ti chiede di autenticarti di nuovo.",
    },
    {
      target: "account-notices",
      title: "Notifiche personali",
      body: "Le ultime 10 notifiche ricevute, compresi gli avvisi di sicurezza.",
    },
    {
      target: "account-refresh",
      title: "Aggiorna stato",
      body: "Rilegge profilo, sicurezza, sessioni e notifiche.",
    },
    {
      target: "account-guides",
      title: "Guide",
      body:
        "«Rivedi tutte le guide» riparte dal tour generale e riapre ogni guida alla prima visita delle pagine. " +
        "Togli la spunta se preferisci aprirle solo dal pulsante «Guida».",
    },
  ],
};
