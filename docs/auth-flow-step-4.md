# Step 4 — flusso auth e collaudo manuale

## Accesso solo email — 26 ottobre 2026

Il form principale di login contiene solo l’email e invia esclusivamente quel
campo. Per gli utenti collegati, lo SDK avvia il login Connect; la password viene
inserita sul provider. Il callback verificato torna ad ALORA sotto `/admin/`, dove
il passaggio monouso viene scambiato con la sessione e si apre la destinazione
consentita dal profilo (dashboard o agenda personale). Nessuna password Connect
viene acquisita da ALORA durante questo percorso.

Per gli account ancora locali, il mancato accesso senza password apre la modale
di verifica legacy, con risposta priva di nomi o dati locali anche per email
sconosciute. Solo l’invio esplicito della vecchia password richiede la verifica
allo SDK; dopo verifica positiva restano consenso e richiesta di migrazione.
Il form di richiesta attivazione conserva il percorso già esistente.

Un browser già autenticato su Connect come amministratore può restituire quella
identità anche con login_hint demo. Il callback rifiuta l’identità diversa dal
mapping atteso; non adotta account per email né chiude altre sessioni in automatico.
Per cambiare persona occorre cambiare account sul provider. La PWA usa lo stesso
flusso della scheda normale.

Verifica locale: riprodotto il ritorno immediato `access_failed` con una sessione
provider amministratore, poi accesso demo positivo da contesto isolato. Il form
ha un solo input; `/auth/me` e dashboard personale restituiscono 200 dopo il
ritorno. Il 403 di `/team` per team.manage mancante conserva la sessione.
Il rifiuto torna nel frammento `#/login?connect_error=access_failed`, così il
redirect iniziale Angular non perde il messaggio; il client rimuove il parametro
dopo averlo letto. Il messaggio non contiene dettagli provider o token.

190 test automatici, lint e build API/admin passati. Test browser della modale e
del messaggio ripetibili con `scripts/check-auth-email-only.cjs`, usando le stesse
variabili CDP/Playwright documentate in `pwa-remote-only.md`: API simulate, nessuna
pratica reale inviata. Il login demo e il rifiuto dell’identità admin sono invece
verifiche su Connect/Keycloak del Docker locale.
L’SDK in sviluppo è la candidata locale 0.11.0, descritta nello Step 5; le note
0.10.0 seguenti documentano i passaggi precedenti.


## Distribuzione npm adottata — 24 ottobre 2026

ALORA dipende ora dalla versione esatta pubblica [@eulab/connect 0.10.0](https://www.npmjs.com/package/@eulab/connect/v/0.10.0), installata dal registry con integrità SHA-512 verificata e lockfile aggiornato. SHA-256 dell’archivio pubblico: `2e07f936a8d52b9ff47862dcd674e0afa39fe0a4c9919ffa37d4cd9380cc294d`. L’intero archivio pubblico coincide byte per byte con il tarball già collaudato manualmente dall’utente. I tarball vendor/ sono solo archivio storico; npm ci e Docker non dipendono da essi. Le note precedenti sulla candidata locale descrivono la fase precedente alla pubblicazione. Non è stato ripetuto il login dell’utente durante questo cambio di distribuzione.


Aggiornamento 24 ottobre 2026: ALORA usa il tarball SDK 0.10.0 consegnato con schema Connect 013, SHA-256 `2e07f936a8d52b9ff47862dcd674e0afa39fe0a4c9919ffa37d4cd9380cc294d`. Il vecchio servizio enrollment/intake locale è rimosso. Le richieste passano solo dalla facciata ufficiale e dagli endpoint esistenti app-onboarding.

## Configurazione predisposta

- ALORA: `http://127.0.0.1:53020/admin/#/login`; Connect: `http://localhost:8088`.
- Il `.env` ALORA contiene ID e segreto del presenter tecnico, chiave di cifratura, sourceId stabile dichiarato, appId proposto, callback e URL di ritorno. Non pubblicare il contenuto del file.
- Il presenter è stato emesso tramite amministrazione Connect per questo deployment, senza origini/app preapprovate e senza inviare pratiche. Non è una sorgente o integrazione già approvata.
- `ALORA_CONNECT_BOOTSTRAP_SECRET` resta vuoto: serve solo alle vecchie sorgenti già registrate. `ALORA_CONNECT_ISSUER` e CLIENT_ID restano vuoti nella nuova fase; vengono acquisiti dallo SDK dopo configurazione amministrativa.
- `COMPOSE_FILE` nel `.env` abilita il normale Compose più `docker-compose.connect-local.yml`. Il Nginx esistente termina TLS interno per l’API Connect usando la CA privata in `.local/connect-dev`; il backend Node la considera attendibile tramite NODE_EXTRA_CA_CERTS. Non è un certificato pubblico, non è esposto un nuovo endpoint sull’host e non viene falsificato il trasporto HTTPS.
- La rete Connect di sviluppo è `eulab-connect_edge`, configurabile con ALORA_CONNECT_DOCKER_NETWORK. Questo override richiede che il Docker Connect sia avviato. `.local/` e `.env` sono esclusi da Git e dal build context.

L’API Compose è stata ricreata per acquisire i valori. Il collaudo funzionale è riservato all’utente. Sono state eseguite soltanto verifiche tecniche di raggiungibilità, compilazione e configurazione.

## Percorso che l’utente deve verificare

1. Inserire le credenziali demo (`demo@barber.test`, password DEMO_OWNER_PASSWORD nel `.env`). Lo SDK consulta Connect, riserva la provenienza usando il presenter e verifica il profilo locale. Non crea app, cliente, licenza o sessione gestionale.
2. Deve aprirsi la modale obbligatoria con il profilo verificato. Nessun «Non ora». Challenge/cookie monouso e consenso sono gestiti dallo SDK.
3. «Invia richiesta» deve creare una pratica nelle Attivazioni e migrazioni Connect. La password viene inviata solo su TLS e conservata temporaneamente cifrata da Connect; ALORA non la registra.
4. Nel pannello Connect controllare la provenienza e scegliere/creare applicazione, cliente e installazione. Una corrispondenza verificata univoca prepara la scelta; non approva da sola l’accesso. Se la persona esiste, scegliere esplicitamente l’identità.
5. Configurare catalogo raggiungibile e client OIDC/callback corretti, licenza e ruoli. Soltanto «Esegui migrazione» applica il piano. Chi esegue il collaudo sceglie se e quando farlo.
6. Al login successivo ALORA chiama configuration.sync nel backend. Lo SDK conserva la configurazione approvata cifrata nel proprio store, poi avvia SSO. Nessun segreto passa nel risultato frontend.
7. Dopo SSO verificato, collegamento/provisioning locale con ID autorizzati; hash, ruoli e relazioni dei profili esistenti restano invariati. Utenti solo Connect: hash locale casuale, nessuna copia della password provider.

Le funzioni concesse da Connect e le restrizioni ALORA devono essere entrambe soddisfatte. Utenti sospesi/revocati non tornano al login locale. Esiti administrative_required/configuration_required bloccano l’accesso e mostrano la necessità d’intervento amministrativo, senza generare una finta pratica.

## Prerequisiti da verificare prima di completare la migrazione

Il trasporto ALORA → API Connect è predisposto nel Compose locale. Il recupero del catalogo e i callback/provider restano da verificare nel collaudo dell’utente. Un URL HTTP locale del catalogo può richiedere il mapping interno esplicito previsto da Connect oppure un URL HTTPS ammesso: non inserire matrici direttamente nel database e non disabilitare la policy SSRF.

L’issuer canonico Keycloak resta `http://localhost:8080/realms/eulab` per il browser e la validazione dei token. Nel container `localhost` indicava ALORA e causava ECONNREFUSED durante il callback (`connect_error=access_failed`). Lo SDK usa ora l’opzione server-only `oidcTransportOrigin`, configurata da ALORA_CONNECT_OIDC_TRANSPORT_ORIGIN=https://nginx nel Compose locale, per raggiungere gli endpoint provider tramite TLS interno. Non cambia issuer, PKCE, audience o URL di login del browser. Discovery dal container: HTTP 200 con issuer canonico invariato. Scambio token e login completo restano da riprovare dall’utente. Non occorre ripetere una migrazione già completata.

## Standardizzazione: revisione del codice, non collaudo funzionale

Il motore condiviso è nello SDK: presenter, discovery, challenge, consenso, pratica, configurazione approvata, PKCE, cookie, rinnovo e logout. ALORA mantiene configurazione, adattamento HTTP e i tre adattatori verifyLegacy/provision/restrict. Il ponte LocalSession serve alla UI legacy ALORA e non va copiato in una nuova app.

Vincoli attuali: Node >=22, store PostgreSQL condiviso o store conforme al contratto, callback e UI nella stessa origine, provider con endpoint Keycloak e quattro ruoli locali interoperabili (owner/manager/reception/collaborator). Il protocollo è riutilizzabile fra app Connect, ma questi vincoli non equivalgono a compatibilità universale con qualsiasi provider o modello utenti.

Controlli di questa adozione: checksum/installazione, compilazioni API/admin, lint e configurazione Compose. Nessuna suite automatica o prova utente rieseguita per richiesta dell’utente. I risultati storici restano separati. Step 4 ancora aperto, nessuna pubblicazione npm.


## Esito della revisione di standardizzazione

| Aspetto | Stato |
| --- | --- |
| Endpoint/pratiche/pannello | Un solo contratto app-onboarding; nessun intake consumer parallelo |
| Prima richiesta e SSO | Stessa istanza SDK, presenter prima dell’approvazione, configuration.sync dopo la decisione amministrativa |
| Regole del dominio | Solo verifyLegacy/provision/restrict e adattamento HTTP in ALORA |
| Catalogo | App ID scelto nel piano letto dal getter SDK, capacità ALORA dichiarate dal catalogo unico |
| Segreti e configurazione | Presenter e chiave nel backend; configurazione approvata cifrata nello store; nessun segreto al frontend |
| Installazione | Tarball e lockfile verificati, npm ci nelle immagini; i vecchi volumi sono stati riallineati al contenuto della candidata |
| Riutilizzo | Motore riutilizzabile nelle app Connect entro i vincoli dichiarati sopra; l’esempio Workshop è evidenza della consegna Connect, non un nuovo collaudo di questo intervento |
| Accettazione finale | Da eseguire dall’utente sull’installazione ALORA effettiva |

Il processo è standardizzato nel contratto e il consumer ha eliminato le duplicazioni introdotte. La generalizzazione funzionale completa sull’ambiente effettivo resta subordinata al collaudo dell’utente; non viene attestata dal solo build o da configuration_valid.

## PWA e risorse sviluppo

Il service worker gestisce esclusivamente push e clic sulle notifiche, senza handler fetch. Prima del bootstrap viene aggiornato e vengono cancellate le precedenti Cache Storage. Pagine e API usano la normale rete del browser. Anche Nginx invia Cache-Control: no-store. Non esiste un fallback offline. Le due risorse di sviluppo Vite sono esposte con percorsi esatti (HTTP 200), senza un proxy generico verso il filesystem. Dopo il deploy chiudere e riaprire la PWA per acquisire il nuovo worker.

### Diagnostica callback

Il nuovo tentativo manuale dell’utente arriva al callback e torna ancora con `connect_error=access_failed`. Il trasporto raggiungibile non basta a certificare il login. La candidata SDK annota ora gli errori callback con `callbackStage` (flow, token_exchange, id_token, context, authorization, handoff), mantenendo invariato il codice di errore. ALORA registra soltanto fase e codice da elenchi chiusi nel log backend `[connect-callback]`; non registra query, messaggi provider, token o identità. Questa diagnostica operativa resta disponibile per individuare il punto esatto al prossimo tentativo dell’utente. Compilazioni e lint passati; nessun login automatico o modifica della pratica.

## Conferma manuale dell’utente — 24 ottobre 2026

Dopo il riallineamento del client OIDC (audience connect-api e scope basic), l’utente ha confermato che l’accesso all’admin ALORA funziona. È una verifica manuale sull’installazione Docker locale: non equivale al collaudo di rinnovo, revoca, permessi, MFA o produzione. Nessuna migrazione o sessione utente è stata eseguita automaticamente per questa verifica.

Verifica adozione npm: integrità del tarball pubblico confrontata con il manifest registry; tutti i file SDK dell’immagine ricostruita con npm ci corrispondono al tarball verificato. I volumi node_modules dei tre servizi sono stati riallineati dall’immagine npm, compresi i metadati del pacchetto, conservando i dati applicativi. Build API/admin, lint e build delle tre immagini superati. Nessun login automatico o migrazione ripetuta. La risoluzione DNS temporanea è stata limitata al comando npm host e non cambia la configurazione di sistema.
