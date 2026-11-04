> Stato corrente, 26 ottobre 2026: l’utente ha autorizzato la candidata locale 0.11.0 nello sviluppo ALORA. package.json, lockfile e Docker usano vendor/eulab-connect-0.11.0-team-security.tgz (SHA-256 d84f5290c27fd877c4874c836af321e3add9df832817daa9b1c9b8f0dd3b3574). application.team.createUser e il recupero della sessione dopo errori transitori sono integrati; Connect/schema 014 e il percorso C1 principale sono verificati nel Docker locale. I sottocasi ancora aperti sono elencati nella checklist Step 5. Le note seguenti sulla 0.10.0 pubblica descrivono la distribuzione precedente, non quella di sviluppo attuale.

# Requisito trasversale — integrazione Connect rapida nelle prossime app

## Distribuzione npm adottata — 24 ottobre 2026

ALORA dipende ora dalla versione esatta pubblica [@eulab/connect 0.10.0](https://www.npmjs.com/package/@eulab/connect/v/0.10.0), installata dal registry con integrità SHA-512 verificata e lockfile aggiornato. SHA-256 dell’archivio pubblico: `2e07f936a8d52b9ff47862dcd674e0afa39fe0a4c9919ffa37d4cd9380cc294d`. L’intero archivio pubblico coincide byte per byte con il tarball già collaudato manualmente dall’utente. I tarball vendor/ sono solo archivio storico; npm ci e Docker non dipendono da essi. Le note precedenti sulla candidata locale descrivono la fase precedente alla pubblicazione. Non è stato ripetuto il login dell’utente durante questo cambio di distribuzione.


Aggiornamento 24 ottobre: requisito consegnato e adottato tramite presenter e configuration.sync della stessa facciata SDK 0.10.0/schema 013. Nessun nuovo intake: riutilizzati app-onboarding, pratiche e pannello esistenti. Il servizio enrollment locale è rimosso. [Adozione e revisione di standardizzazione](auth-flow-step-4.md); il collaudo dell’installazione effettiva è riservato all’utente. Le sezioni seguenti conservano i requisiti e la baseline precedenti.

Decisione del 22 ottobre 2026: continuare il piano ALORA, ma usare questa integrazione per consolidare un SDK che la prossima applicazione possa istanziare e richiamare, senza ricopiare il protocollo. Questa capacità è un requisito di integrazione, non una nuova milestone di prodotto ALORA né un motivo per interrompere i collaudi in corso.

Aggiornamento consegna: SDK 0.10.0 ricevuto e installato dal tarball locale verificato. `@eulab/connect/application` espone ora ConnectApplication e lo store PostgreSQL; il recupero è dichiarato nel contratto schema 012. Le sezioni seguenti conservano i requisiti originari. ALORA ha introdotto configurazione condivisa, diagnostica delegata alla facciata e adattatori di dominio verificati; gli handler HTTP e le sessioni provider sono ora collegati alla facciata, con compatibilità dei token opachi UI. Restano configurazione/collaudo operativo e browser; il caso di attivazione descritto in connect-activation-action-request.md è risolto e verificato nel consumer. Nessuna pubblicazione npm intermedia.

## Confine

Connect SDK deve governare il flusso comune: risoluzione Connect prima del legacy, stati della pratica e reinvio, challenge e consenso, Authorization Code/PKCE/state/cookie/handoff, sessioni server cifrate, rinnovo concorrente e revoca, validazione dell’identità/installazione/ID locale, errori tipizzati e non sensibili. I token provider rimangono sul backend. Il catalogo e i metodi di autorizzazione, squadra e WhatsApp restano servizi dello stesso client applicativo.

L’applicazione fornisce configurazione server, catalogo funzioni e adattatori per verificare le credenziali legacy, creare/risolvere il profilo locale dopo SSO, applicare le proprie restrizioni e conservare i dati del flusso. Non si trasferiscono schema dei saloni, Prisma ALORA o terminologia ALORA nell’SDK. Ruoli e permessi Connect non sostituiscono l’isolamento dei dati applicativi.

La registrazione della sorgente, i segreti, il client/callback OIDC e una persistenza condivisa sono prerequisiti espliciti. Nessun default amministrativo, credenziale nel browser, join automatico per email o creazione libera di licenze. Semplicità d’integrazione non significa eliminare queste autorizzazioni.

## Interfaccia obiettivo da concordare con l’agente Connect

Esempio concettuale: i nomi seguenti NON sono esportazioni già disponibili nello SDK 0.9.0.

```ts
const connect = new ConnectApplication({
  ...serverConfiguration,
  store: sharedSessionStore,
  accounts: {
    verifyLegacy: verifyLocalCredentials,
    provision: provisionAuthorizedLocalProfile,
  },
});

await connect.auth.signIn(input, browserContext);
await connect.migration.submit(input, browserContext);
await connect.activation.submit(input, browserContext);
await connect.auth.callback(input, browserContext);
await connect.auth.exchange(handoff, browserContext);
await connect.auth.resolve(session);
await connect.auth.refresh(session);
await connect.auth.logout(session);
await connect.access.authorize(session, functionKey);
```

SignIn deve restituire un’unione discriminata: redirect SSO, richiesta di migrazione oppure pratica pendente; mai una sessione operativa locale. Lookup per email e pratica non autenticano. Provision viene chiamato soltanto dopo autenticazione SSO e verifica del collegamento esplicito; non dopo la sola discovery. Le azioni obbligatorie del provider non vengono aggirate. Il consenso alla migrazione non è una licenza.

Il modulo deve essere indipendente da Nest/Angular: piccoli adattatori HTTP per framework traducono request, cookie e redirect senza implementare la sicurezza. Fornire un contratto di store con scadenze, cifratura, consumo atomico e lock/rotazione; un adattatore pronto per un backend condiviso supportato. Nessuna sola Map in memoria come default di produzione. La transazione di provisioning e consumo del flusso deve poter condividere il contesto transazionale dell’applicazione oppure avere riconciliazione idempotente esplicita, senza promettere atomicità fra sistemi distinti.

## Richiesta esecutiva per Connect

Realizzare la facciata nel repository Connect preservando i metodi pubblici 0.9.0. Usare ALORA come caso di accettazione e la demo indipendente come prova di riuso. Le responsabilità oggi nel consumer sono individuabili qui:

| Codice ALORA attuale | Responsabilità da portare nel modulo comune | Parte che rimane applicativa |
| --- | --- | --- |
| `modules/auth/auth.controller.ts`, `connect-migration.service.ts` | Discovery, esiti tipizzati, challenge limitato alla migrazione, consenso, idempotenza e stati/reinvio delle pratiche | Verifica password legacy e proiezione dei dati della richiesta |
| `modules/auth/connect-auth.service.ts` | PKCE, state/cookie, callback, scadenze, handoff monouso e controllo del contesto autorizzato | Provisioning transazionale con ID e profili esistenti |
| `common/connect-runtime.ts` | Configurazione del client, cifratura, verifica accesso e rinnovo concorrente del provider | Lettura del binding dell’azienda tramite store |
| `common/local-sessions.ts`, `request-session.ts` | Collegamento della sessione applicativa a quella Connect, scadenza, rotazione, revoca e blocco del legacy operativo | Risoluzione del profilo e applicazione delle restrizioni sui dati |
| `common/function-catalog.ts`, `local-policy.guard.ts` | Contratti di pubblicazione del catalogo e autorizzazione centrale | Dichiarazione delle funzioni, isolamento aziendale e restrizioni personali |

I percorsi della tabella sono relativi a `apps/api/src/`. Non trasferire integralmente questi file nell’SDK: estrarre il comportamento comune attraverso contratti indipendenti da Prisma e dal dominio ALORA.

La guida della prossima app deve avere un percorso completo: installare la versione documentata, registrare sorgente/app/client e callback, configurare i segreti server, istanziare il client, collegare store e account adapter, esporre gli handler HTTP e dichiarare il catalogo. Prevedere uno store pronto all’uso con migrazioni e una ricetta BFF per cookie, redirect e handoff. La UI renderizza soltanto gli esiti tipizzati (redirect, consenso, attesa, errore); non deduce i casi da stringhe HTTP o ricostruisce la macchina degli stati. Il browser non riceve bootstrap secret, credenziali d’installazione o token provider.

Includere una diagnostica iniziale richiamabile dallo stesso client, con errori tipizzati e senza segreti. ALORA espone già `npm run connect:check` come adattatore CLI: riusa la validazione del runtime e loginContext ufficiale, senza scritture. Il controllo comune va poi consolidato nell’SDK, evitando di ricopiarlo nella seconda app. Distinguere configurazione/discovery/sorgente raggiungibili da client, licenza e associazioni effettivamente autorizzati: il primo livello non certifica il secondo.

Il passaggio ALORA al modulo comune è implementato e i collaudi consumer sono stati adattati: protocollo provider rimosso dal consumer, adattatori locali conservati e sessioni opache UI compatibili. Non è stato introdotto un SDK privato da ricopiare nella prossima app. Rimangono accettazione browser/operativa e la regressione Connect segnalata separatamente.

### Recupero dopo rifiuto della password

Il collaudo reale del 22 ottobre (`scripts/check-connect-password-policy.mjs`) conferma il comportamento Connect `failed` con `actionRequired: password_change_required`: credenziale transitoria eliminata, identità non creata, accesso ALORA bloccato. Gli endpoint 0.9.0 esponevano soltanto `{requestId,state}`. La 0.10.0 espone nextAction e ALORA gestisce ora choose_connect_password con nuova prova e consenso; il limite della baseline è superato per le migrazioni legacy. Le nuove attivazioni senza account locale richiedono invece l’azione amministrativa descritta in connect-activation-action-request.md.

La facciata richiede quindi un esito sicuro e tipizzato per l’azione successiva, sostenuto dal contratto server, non da interpretazione del messaggio: attesa, nuova credenziale consentita, collegamento amministrativo oppure richiesta terminale. Definire anche il recupero effettivo per `password_change_required` quando la password legacy valida non soddisfa la nuova policy. Una nuova password scelta per Connect deve essere distinta dalla prova della password locale e legata al challenge/consenso verificato. Vietato sostituire l’hash legacy, riaprire pratiche terminali o ritentare automaticamente una credenziale già rifiutata. L’agente Connect deve consegnare contratto e test del recupero prima che ALORA abiliti tale azione; il solo test negativo non certifica il percorso di recupero.

## Accettazione richiesta all’SDK

- Una seconda app dimostrativa, diversa da ALORA e senza dipendenze dai suoi sorgenti, integra il percorso completo con una sola istanza del client e gli adattatori documentati.
- Nessuna reimplementazione consumer di PKCE, token grant, serializzazione del refresh, cifratura o gestione degli stati/reinvii delle pratiche.
- Test comuni coprono replay, concorrenza fra istanze, timeout, revoche, conflitti email/subject, associazioni fra aziende estranee, token/segreti assenti dal browser e dall’audit, azioni obbligatorie e provisioning ripetuto.
- Conservare le API 0.9.0; introdurre la facciata per composizione. Indicare versione e contratti disponibili prima che ALORA li consumi.
- Dopo disponibilità del modulo, ridurre il codice comune di ALORA agli adattatori mantenendo gli stessi collaudi negativi e il percorso assistito approvato.

Stato della baseline precedente: ALORA usava ConnectOnboardingSource 0.9.0 per le pratiche e ConnectServer per accesso/funzioni, con gestione BFF nel consumer. L’adozione 0.10.0 procede in ALORA; il lavoro sul repository Connect resta in carico al suo agente. Nessuna modifica a quel repository è autorizzata implicitamente da questo documento.
