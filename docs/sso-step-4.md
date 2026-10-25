# Step 4 — Accesso Connect obbligatorio e migrazione assistita

## Distribuzione npm adottata — 24 ottobre 2026

ALORA dipende ora dalla versione esatta pubblica [@eulab/connect 0.10.0](https://www.npmjs.com/package/@eulab/connect/v/0.10.0), installata dal registry con integrità SHA-512 verificata e lockfile aggiornato. SHA-256 dell’archivio pubblico: `2e07f936a8d52b9ff47862dcd674e0afa39fe0a4c9919ffa37d4cd9380cc294d`. L’intero archivio pubblico coincide byte per byte con il tarball già collaudato manualmente dall’utente. I tarball vendor/ sono solo archivio storico; npm ci e Docker non dipendono da essi. Le note precedenti sulla candidata locale descrivono la fase precedente alla pubblicazione. Non è stato ripetuto il login dell’utente durante questo cambio di distribuzione.


## Stato corrente — una sola facciata SDK, presenter schema 013

Adottato lo SDK pubblico npm 0.10.0, come descritto sopra. Rimosso il percorso enrollment/intake parallelo: discovery, prova legacy, challenge, consenso, richiesta, attesa e SSO usano la stessa facciata ConnectApplication e gli endpoint app-onboarding esistenti.

Un presenter tecnico identifica il deployment prima dell’approvazione dell’integrazione; nessuna app, azienda, licenza o associazione viene creata dall’emissione della credenziale. ID e segreto sono configurati nel solo `.env` ALORA. Lo SDK recupera poi la configurazione SSO con configuration.sync e la conserva cifrata. ALORA gestisce gli esiti administrative_required/configuration_required senza concedere sessioni o simulare pratiche ricevute. Il catalogo pubblicato segue l’app scelta nel piano tramite il getter SDK.

[Configurazione, percorso manuale e revisione di generalizzazione](auth-flow-step-4.md). L’utente ha eseguito la migrazione e confermato l’accesso all’admin il 24 ottobre. Rinnovo, revoca, MFA, ripristino e accettazione di produzione non vengono dedotti dal login riuscito e restano da collaudare. Lo Step 5 è ora avviato su autorizzazione dell’utente.

Le sezioni successive conservano evidenze del percorso integrato precedente. Le prove del servizio enrollment locale rimosso e la proposta di un intake separato sono ritirate, non rappresentano il contratto attuale.

## Comportamento

Un solo form e un solo pulsante Accedi. Connect viene consultato prima della prova legacy, anche senza profilo locale. Un collegamento autorizzato avvia Authorization Code + PKCE, nonce e verifica dell’ID token firmato; password e MFA restano al provider. Discovery e pratiche non concedono sessioni né creano utenti locali.

Se il server autorizza una nuova richiesta o un reinvio, una prova legacy valida genera un challenge SDK di **120 secondi**, cifrato nello store e legato a cookie HttpOnly/SameSite=Lax. La modale obbligatoria presenta solo «Invia richiesta»; niente «Non ora» o accesso operativo locale. Consenso e password sono verificati nuovamente dall’SDK, che consuma la prova una volta. Un errore o risposta incerta richiede un nuovo accesso esplicito: nessuna ripetizione automatica della mutazione.

`nextAction` decide il percorso: `wait`, `sign_in`, `choose_connect_password`, `resubmit`, `contact_admin`, `closed`. Una scadenza non basta per riaprire una pratica terminale. Per `choose_connect_password`, il form chiede una nuova password Connect e la sua conferma, diverse dalla password locale appena verificata. Soltanto la nuova credenziale viene inviata al recupero; hash e password locali restano invariati. L’amministratore deve eseguire la pratica dopo l’invio. La UI cancella le credenziali al termine, su errore, a scadenza o distruzione; il consenso viene richiesto nuovamente.

Nome e cognome mostrano il profilo locale verificato e non vengono riscritti durante la richiesta. Ruoli, permessi e riferimenti aziendali provengono dagli adattatori e dal contesto autorizzato, mai da un tenant o privilegio scelto dal browser.

Signup apre una pratica di attivazione: nessuna azienda, utenza, abbonamento o sessione locale viene creata. Un errore di configurazione/rete o un rifiuto Connect resta un errore; non viene trasformato in `not_found` né in accesso locale alternativo.

## Confine fra SDK e ALORA

- `common/connect-application.ts`: istanza unica, store PostgreSQL ufficiale, configurazione/cifratura server, catalogo; pruning dei record scaduti ogni cinque minuti dopo l’istanza, tramite SDK.
- `common/connect-accounts.ts`: verifica legacy, provisioning con gli ID autorizzati, restrizioni locali. Profilo, binding, audit e consumo handoff condividono la transazione SQL dello store. Nessuna unione per email, cambio implicito d’azienda o copia della password Connect. Per un profilo nuovo il vincolo legacy riceve un hash casuale inutilizzabile come credenziale nota.
- `common/connect-http.ts`: verifica dell’Origin effettivo sui POST, Host esatto sul callback, cookie SDK tradotti in veri Set-Cookie, errori senza dettagli sensibili. Non si deduce l’origine da Forwarded arbitrari.
- `ConnectAuthService`: traduce gli esiti per la UI esistente. L’handoff opaco viaggia nel fragment e viene rimosso prima dello scambio. La precedente implementazione di grant/refresh/PKCE e il gateway duplicato sono rimossi.

Per compatibilità con la UI, `LocalSession` conserva access/refresh ALORA casuali e distinti. Ogni sessione è collegata a `ConnectSession.sdkSessionCipher`, che contiene soltanto l’handle SDK cifrato. I token provider nuovi risiedono **solo nello store SDK**; `accessCipher` resta vuoto e `refreshCipher` nullo nelle nuove righe compatibili. Le query verificano sempre sessione SDK, accesso Connect, profilo locale e azienda attiva, poi applicano policy e filtri ALORA. Il logout revoca prima la famiglia locale e poi usa il logout SDK; l’esito remoto è esplicito e non promette revoca globale delle altre app.

Il solo `platform_admin` mantiene l’accesso tecnico separato e non può operare sulle aziende. Le sessioni tenant senza SDK, incluse quelle del precedente consumer 0.9, richiedono un nuovo accesso; account e password non cambiano.

## Configurazione e migrazioni

Server-only: ALORA_CONNECT_SOURCE_ID, BOOTSTRAP_SECRET, APP_ID, API_URL, ISSUER, CLIENT_ID, CALLBACK_URL, ALORA_AUTH_RETURN_URL, ENCRYPTION_KEY; CLIENT_SECRET opzionale per un BFF confidential. Nessun valore operativo è stato inserito nel `.env`. HTTPS fuori dal loopback di sviluppo; callback e UI devono avere la stessa origine. `ALORA_CONNECT_TENANTS_JSON` mantiene i binding espliciti precedenti ma non abilita accesso locale.

Il proxy deve preservare l’Host pubblico comprensivo di porta; Nginx usa `$http_host`. L’access log delle route `/api/auth` è disattivato per evitare code/state negli URL di callback; le risposte auth sono no-store/no-referrer. La configurazione Nginx passa `nginx -t`; non è una prova dell’ingresso pubblico.

Migrazioni **ALORA**, additive e applicate solo sul database isolato:

- `20261022000000_connect_application_store`: store ufficiale SDK 001, rappresentato anche in Prisma.
- `20261022010000_connect_sdk_session_bridge`: handle cifrato SDK sulle sessioni compatibili.

Schema **Connect 012** separato: necessario per `/v1/app-onboarding/password-recovery`, non va applicato nel database ALORA. Il nuovo controllo sul Connect Docker locale rileva ora la tabella onboarding_password_recoveries presente e la route di recupero registrata (400 su richiesta intenzionalmente incompleta). Il precedente controllo di assenza è superato. Questa adozione non ha applicato la migrazione né modificato Connect: l’allineamento è avvenuto esternamente. La prova completa di recupero sotto usa ancora un server/schema 012 temporaneo; metadati e route presenti non equivalgono al collaudo autorizzato dell’installazione operativa.

Eseguire `npm run connect:check` dopo build API; `-- --online` delega a `ConnectApplication.diagnose`. Configurazione/discovery/sorgente raggiungibili non certificano client, licenze o mapping: autorizzazione resta `not_checked`. Le nove variabili richieste sono ancora vuote nell’ambiente operativo locale.

## Verifiche correnti

| Prova | Evidenza e confine |
| --- | --- |
| Suite consumer | 135 test su 28 suite, build API/admin e lint passati |
| `check-connect-onboarding.cjs` | 51 controlli HTTP, API e PostgreSQL reali, Connect/OIDC simulati con ID token firmato: Origin, risposta sorgente malformata, blocco legacy, challenge/consenso/replay, conflitti, permessi, refresh e logout |
| `check-connect-real-oidc.mjs` | [35 controlli](verification/connect-real-oidc.json), Connect Docker/Keycloak/PostgreSQL reali, PKCE/nonce/ID token, hash preservato, Connect-only, MFA, rinnovo e logout provider attivo. HTTP, non browser; catalogo inizializzato dalla matrice |
| `check-connect-catalog-https.mjs` | [15 controlli più 6 negativi](verification/connect-catalog-https.json), reader/TLS reali con CA e origine QA temporanee; Connect PGlite e provider simulato |
| `check-connect-password-policy.mjs` | [15 controlli](verification/connect-password-policy.json), rifiuto e recupero legacy con Keycloak temporaneo reale, nuova approvazione, hash preservato e cancellazione credenziale; Connect PGlite/admin simulati |
| `check-connect-restore.cjs` | [17 controlli, 32 tabelle](verification/connect-restore.json), migrazione ripetibile, compatibilità checkpoint, centesimo alterato rilevato, nuove scritture conservate e prova SDK ripresa dal restore; chiave errata e replay rifiutati. Non è copia produzione |
| Adattatori e diagnostica | 12 controlli su PostgreSQL temporaneo e 6 casi CLI; nessuna certificazione operativa |

I report passati richiedono pulizia delle proprie fixture. I test GUI restano impediti dall’avvio CUA (`Sky Computer Use service startup request failed`). Nessun browser, TLS pubblico o rilascio produzione dichiarato riuscito.

## Correzione verificata: nuova attivazione senza account legacy

La [regressione dedicata](verification/connect-activation-action.json) ora passa sul tarball aggiornato 0.10.0: dopo `activation` + `failed/password_change_required`, Connect espone `contact_admin`. La facciata restituisce `pending` con e senza password, senza invocare la verifica legacy, scrivere nello store, effettuare provisioning o emettere challenge, cookie o sessioni. Il recupero legacy sulla richiesta di attivazione resta respinto con 409. La prova usa handler Connect reali e PGlite temporaneo, con stato di rifiuto provider iniettato; non è un collaudo provider reale.

La [richiesta tecnica](connect-activation-action-request.md) è risolta. Il nuovo tarball ha SHA-256 `752575ccb8970e380fe9767ecf201e26cab083b4e6de6a9282be0f5e0acb63db`: copiato invariato, installato offline e confrontato con tutti i file dist installati. Lockfile aggiornato anche se la versione resta 0.10.0, ancora non pubblicata. Nessuna modifica ai sorgenti o al database operativo Connect.

## Ricollaudo della candidata aggiornata — 22 ottobre 2026

Sul tarball con checksum `752575ccb8970e380fe9767ecf201e26cab083b4e6de6a9282be0f5e0acb63db` ripetuti con esito positivo: 135 test/28 suite, build API e admin, lint, 51 controlli HTTP consumer con provider simulato, 15 controlli contro gli handler Connect/PGlite effettivi e 35 controlli con Connect Docker/Keycloak/PostgreSQL reali, inclusi MFA, rinnovo e logout provider. La regressione attivazione è ora verde; fixture QA eliminate. I precedenti report TLS, recupero legacy e restore restano prove separate della baseline, non sono stati rieseguiti in questa tornata. `connect:check` continua a rilevare nove variabili operative mancanti. Nessuna pubblicazione npm, configurazione operativa o migrazione Connect eseguita dal consumer.

## Registro delle implementazioni e verifiche precedenti

I paragrafi seguenti sono storici: versioni, conteggi e limiti sono quelli della relativa prova; non sostituiscono lo stato corrente sopra.

## Correzione reinvio di richieste scadute — 22 ottobre 2026

Dopo un nuovo login locale verificato, una richiesta `expired` può essere ripresentata dalla modale, con consenso da confermare nuovamente. Il pannello conserva la password solo in memoria per massimo due minuti, come per la prima richiesta. Invio, errore, scadenza e distruzione del componente la cancellano. Dopo qualsiasi risposta all’invio il challenge viene invalidato nella UI: una pratica terminale restituita ancora `expired` non provoca invii ripetuti. Connect decide se la pratica è ancora aperta; la chiave stabile del backend rimane invariata.

Gli stati pending, approved, migrating, completed, rejected e failed restano bloccati: il contratto corrente non fornisce alla modale l’informazione necessaria a distinguere tutti i casi di reinvio consentito. Nessun accesso operativo viene concesso dalla richiesta.

Verifica: 123 test su 27 suite superati, inclusi i nuovi casi su modale e pannello; build admin, lint e diff-check superati. Tentato un controllo con Chromium headless e risposte auth simulate, ma il browser termina prima di aprire la pagina con errore macOS MachPortRendezvousServer/SIGTRAP. Nessun collaudo browser dichiarato riuscito per questa correzione. Nessuna modifica al repository Connect.


## Collegamento al client ufficiale — 22 ottobre 2026

SDK locale 0.9.0 compilato in staging temporaneo e impacchettato in vendor, senza pubblicazione npm o modifica dei sorgenti Connect. Il gateway ALORA usa ConnectOnboardingSource invece del trasporto HTTP provvisorio; i tipi di contesto e richiesta provengono dallo SDK, mentre proiezioni, validazione e messaggi senza dettagli sensibili restano nel consumer. La tipizzazione ha reso esplicito che i profili legacy `client` non sono collaboratori e non possono avviare una migrazione della squadra.

Verificati 90 test Connect, inclusi i tre casi precedentemente segnalati (rifiuto concorrente, pratica terminale e AAD al reinvio), e 125 test ALORA. I 43 controlli HTTP isolati ALORA passano usando realmente il pacchetto SDK 0.9.0.

Nuovo script `scripts/check-connect-contract.mjs`: 15 controlli HTTP fra API ALORA e handler sorgente/admin/access di Connect, con PostgreSQL ALORA isolato e PGlite Connect. L’approvazione viene eseguita tramite HTTP admin, il catalogo proviene dalla matrice effettiva ALORA, la pratica cifrata è completata e la credenziale rimossa; seguono callback SSO, cutover legacy, creazione locale dell’utente solo Connect e revoca della licenza. Il provider OIDC/Keycloak e il catalog reader sono sostituiti da fixture esplicite: questa prova non certifica il provider reale o la protezione SSRF del reader. Le fixture ALORA create dallo script vengono eliminate alla fine e il Connect Docker operativo non riceve registrazioni.

Esecuzione: prima compilare l’API ALORA e il checkout Connect; quindi impostare DATABASE_URL esclusivamente su barber_security_test ed eseguire `node scripts/check-connect-contract.mjs`. CONNECT_CHECKOUT consente di indicare un checkout diverso da `../eulab connect`; CONNECT_CONTRACT_PORT cambia la porta API di prova. Il consumer usa i sorgenti compilati Connect attraverso il suo harness di test, senza modificarli.

Restano aperti la configurazione operativa della sorgente e degli URL, il ciclo browser/Keycloak reale, password policy/MFA/azioni obbligatorie, prove di ripristino della release e accettazione di produzione. Lo Step 4 e il piano complessivo non sono conclusi.

## Collaudo reale del provider via HTTP — 22 ottobre 2026

Aggiunto `scripts/check-connect-real-oidc.mjs`, eseguito con Connect Docker e Keycloak reali, database Connect PostgreSQL reale e database ALORA isolato barber_security_test. Richiede opt-in `ALORA_REAL_CONNECT_QA=1`; legge le credenziali amministrative locali dal `.env` Connect in memoria, non le stampa e non modifica il file. Non usa password grant: sia il login admin sia quello della persona percorrono Authorization Code + PKCE con cookie e form HTTP del provider. Non si tratta di una prova browser.

Esito finale: **20 controlli HTTP superati**, con [report JSON](verification/connect-real-oidc.json). Verificati invio ALORA di una pratica reale, credenziale cifrata e cancellata dopo esecuzione, approvazione tramite API admin, login con la stessa password migrata, callback/handoff e accesso ai dati autorizzati, preservazione dell’account legacy, rinnovo effettivo del token Keycloak, creazione locale del profilo di una persona inizialmente solo Connect senza copia della sua password, blocco del completamento SSO per password temporanea con azione obbligatoria, revoca di licenza e logout.

La prova usa i client OIDC locali già esistenti connect-admin e connect-demo; non cambia realm/client/callback o policy Keycloak. Crea esclusivamente sorgente, pratica, app, cliente, ruoli e identità QA temporanei con identificativi casuali. Il report è dichiarato passato soltanto dopo la pulizia, verificata anche per le identità del provider e gli audit della fixture. Nessun sorgente o configurazione Connect viene riscritto, nessuna azienda operativa viene attivata.

Limiti di trasporto e catalogo: per raggiungere gli endpoint sorgente dal test si usa un bridge HTTP limitato a 127.0.0.1 che esegue le chiamate sul loopback del container API. Non certifica l’ingresso pubblico TLS. Il catalogo viene inizializzato nel database QA dalla matrice effettiva ALORA; il suo recupero HTTPS con CatalogReader e la protezione SSRF non sono provati da questo script. Le credenziali sono trasmesse in memoria/stdin ai processi del test, mai attraverso argomenti CLI contenenti i valori.

Ripetizione: compilare l’API ALORA, avviare il Connect Docker locale e il PostgreSQL/Redis di prova ALORA, assicurare libera la porta localhost:5174, poi impostare ALORA_REAL_CONNECT_QA=1 e DATABASE_URL del solo barber_security_test prima di eseguire `node scripts/check-connect-real-oidc.mjs`. Non usare questo script su produzione.

Il controllo browser tramite CUA fallisce ancora con “Sky Computer Use service startup request failed”. Restano aperti browser/resa/focus, MFA e password-policy rejection reali, recupero HTTPS del catalogo, trasporto e configurazione dell’installazione operativa, backup/ripristino della release e accettazione di produzione. Lo Step 4 non è dichiarato concluso.

## Recupero HTTPS del catalogo con reader reale — 22 ottobre 2026

Aggiunto `scripts/check-connect-catalog-https.mjs`, che esegue il contratto fra API ALORA e API Connect isolate usando il CatalogReader effettivo del checkout Connect. Una CA temporanea viene aggiunta soltanto al processo Node di test tramite NODE_EXTRA_CA_CERTS; la verifica TLS resta attiva. Il mapping ufficiale CATALOG_INTERNAL_ORIGINS_JSON associa esclusivamente l’origine QA a un server HTTPS di loopback che inoltra il GET alla matrice ALORA effettiva. Nessuna configurazione o sorgente Connect viene modificato, nessun certificato viene installato nel sistema.

Esito: **15 controlli HTTP del contratto completi e 6 negativi sul catalogo superati**, con [report JSON](verification/connect-catalog-https.json). L’importazione mantiene tutte le 22 funzioni e i loro metadati; il confronto ignora solo l’ordine, che Connect normalizza. I negativi verificano rifiuto di HTTP, indirizzo privato non mappato, redirect 302, MIME HTML, JSON malformato e certificato emesso da CA non attendibile. Il GET catalogo non porta Authorization o cookie dell’utente. I file di chiave/certificato e le fixture applicative sono eliminati al termine.

Esecuzione: con API ALORA e checkout Connect compilati, impostare DATABASE_URL sul solo barber_security_test ed eseguire `node scripts/check-connect-catalog-https.mjs`. Sono richiesti OpenSSL e i servizi PostgreSQL/Redis di prova; CONNECT_CHECKOUT e CONNECT_CONTRACT_PORT sono opzionali. Il processo avviato usa una porta ALORA separata (53027 per default).

Questa verifica sostituisce il reader simulato soltanto nella variante HTTPS del test: provider OIDC simulato, database Connect PGlite. La prova separata con Keycloak/Docker reali rimane quella da 20 controlli, con catalogo inizializzato dalla matrice. Non si certifica un dominio pubblico o la configurazione di rete/TLS dell’installazione operativa. Browser, MFA e accettazione di produzione restano aperti.

Requisito aggiunto dall’utente: [integrazione rapida tramite istanza SDK e metodi](connect-sdk-integration-contract.md). Il consolidamento del flusso BFF comune deve permettere alla prossima applicazione di fornire solo configurazione e adattatori locali, senza copiare protocollo e sessioni. La disponibilità di questa facciata non viene dedotta dal solo client sorgente 0.9.0: resta un punto da concordare con l’agente Connect mentre il piano ALORA continua.

## MFA reale e blocchi del provider — 22 ottobre 2026

Il collaudo `check-connect-real-oidc.mjs` ora esegue **32 controlli HTTP reali**. Per una sola identità QA creata dal test richiede CONFIGURE_TOTP attraverso il servizio amministrativo del provider; non cambia il realm, il client o alcuna utenza esistente. L’enrollment usa la chiave Base32 del percorso manuale del provider e il suo form HTTP effettivo. Chiave, codici OTP e token restano in memoria e non sono inclusi nel report.

Verificati: completamento dell’enrollment con il codice corretto; nessuna nuova sessione ALORA quando manca l’OTP; rifiuto di un codice errato senza rilascio di sessione; accesso con codice corretto; conservazione della richiesta di cambio password obbligatorio già coperta. Prima di riutilizzare il dispositivo il test attende il periodo successivo, rispettando il controllo anti-riuso del provider. Le identità temporanee vengono poi eliminate, incluse le credenziali MFA, e il report passato richiede cleanupVerified.

[Report aggiornato](verification/connect-real-oidc.json): realKeycloak/realConnectDocker/realPostgres true, realBrowser false. La matrice è ancora inizializzata dalla risposta ALORA in questo collaudo; il reader HTTPS reale è verificato nel test separato sopra. MFA TOTP a livello protocollo è quindi verificata; resa e interazione browser, password-policy rejection, backup/ripristino e configurazione dell’ambiente operativo restano aperti. Questo non dichiara conclusi lo Step 6 o il piano complessivo.

## Migrazione additiva e ripristino isolato — 22 ottobre 2026

`scripts/check-connect-restore.cjs` supera **15 controlli su PostgreSQL e riconcilia tutte le 30 tabelle**: [report](verification/connect-restore.json). Legge il database di prova `barber_security_test` con pg_dump e opera soltanto su due cloni temporanei. In un clone ricostruisce lo schema precedente a Connect, applica le migrazioni additive con checkpoint e le riapplica senza duplicazioni. Verifica colonne e dati legacy, password hash e importi, compatibilità delle impronte storiche e rifiuto di una variazione di un centesimo. Dopo nuove scritture operative e sessioni/binding Connect, ripristina un backup su un secondo clone e confronta tutte le tabelle, incluse quelle di autenticazione.

Corretto un difetto dei checkpoint: la tabella ConnectTenantBinding non ha `id`, mentre l’algoritmo precedente presumeva quella colonna per l’ordinamento. Il nuovo helper `scripts/lib/database-checkpoint.cjs` produce impronte versione 2 indipendenti dalla chiave primaria e conserva la proiezione delle colonne originarie attraverso le aggiunte di schema. I checkpoint precedenti mantengono il proprio algoritmo. Entrambi i comandi di migrazione richiedono ora `ALORA_MIGRATION_WRITES_FROZEN=1` per applicare: l’operatore deve prima sospendere davvero le scritture.

Il ripristino mantiene anche una vendita successiva alla migrazione e i cifrati di installazione/sessione, leggibili con la chiave originale; una chiave diversa viene rifiutata. Le sessioni locali senza collegamento Connect rimangono bloccate. Il checkpoint di un database non può essere usato su un altro; la prova di restore confronta quindi separatamente le impronte complete. Report passato soltanto dopo cleanup dei due cloni e dei backup temporanei; nessun dato o segreto finisce nel report.

Ripetizione: compilare l’API, impostare DATABASE_URL sul solo `barber_security_test` locale ed eseguire `node scripts/check-connect-restore.cjs`, con il container `barber-security-postgres` avviato. Non richiede modifiche o registrazioni Connect. La prova dimostra migrazione e recupero dello schema corrente in isolamento; restano la copia recente della produzione, custodia/ripristino delle chiavi operative, procedura dell’ambiente effettivo e accettazione di rilascio. Non prova un downgrade a una release che riaprirebbe il login locale.

## Rifiuto reale della password — 22 ottobre 2026

Il realm operativo locale non dichiara una password policy; non è stato modificato. Il nuovo `scripts/check-connect-password-policy.mjs` avvia invece un container Keycloak temporaneo, senza volumi condivisi, con un realm QA e policy `length(64)`. Collega la gestione identità effettiva di Connect a quel provider, lasciando il database Connect nel suo harness PGlite e l’autenticazione admin simulata. ALORA usa API e PostgreSQL isolato reali. Non viene modificato alcun file, realm o utente operativo Connect.

**11 controlli superati**, [report](verification/connect-password-policy.json): il provider rifiuta la password della pratica; Connect restituisce `failed` e `password_change_required`, cancella il cifrato e non collega identità o utenti applicativi. Il nuovo login ALORA rimane nel percorso obbligatorio di migrazione e non crea sessioni locali o Connect. Profilo, hash e stato di attivazione legacy restano invariati. Il provider non contiene un’identità residua per il tentativo rifiutato; un controllo positivo con password conforme conferma che la policy è applicata da un servizio funzionante. Container e fixture eliminati prima del report passato.

Esecuzione: API ALORA e Connect compilate, PostgreSQL/Redis ALORA di prova avviati e immagine locale `eulab-connect-keycloak:latest` disponibile; impostare DATABASE_URL sul solo `barber_security_test`, poi `node scripts/check-connect-password-policy.mjs`. La porta Keycloak è casuale e limitata a loopback; l’API ALORA QA usa 53028. Il password grant è usato esclusivamente per bootstrap amministrativo del container appena creato, non per il login degli utenti ALORA. La variante normale di `check-connect-contract.mjs` mantiene il provider simulato.

Limite funzionale rilevato: il contratto sorgente restituisce soltanto stato/ID della richiesta, quindi ALORA non riceve l’azione `password_change_required`. Il blocco è verificato; la procedura con cui la persona sceglie una nuova password Connect non è ancora disponibile e non viene dichiarata completata. Richiesta aggiunta al [contratto SDK riutilizzabile](connect-sdk-integration-contract.md). Restano browser, recupero da questo errore, configurazione operativa e collaudo su copia della produzione; lo Step 4 resta aperto.

## Controllo rapido di configurazione — 22 ottobre 2026

Disponibile `npm run connect:check`, con variante `-- --online`: usa la stessa funzione `connectApplicationConfig()` del runtime, senza database o binding fittizi. Elenca le variabili assenti oppure verifica URL, chiave e coerenza del callback. La modalità online verifica issuer e supporto S256 della discovery, quindi istanzia ConnectOnboardingSource dello SDK e invoca soltanto loginContext con un indirizzo casuale `@example.invalid`. Nessuna pratica, invio di password o scrittura applicativa. Risultati distinti per configurazione assente/non valida, discovery fallita e sorgente rifiutata/non disponibile; nessun valore di configurazione o corpo d’errore remoto viene stampato.

Il comando offline eseguito nel checkout segnala ancora le nove variabili Connect mancanti. Questo è un esito diagnostico previsto, non un collegamento operativo riuscito. L’SDK nel checkout Connect è ancora 0.9.0 e non espone la facciata riutilizzabile richiesta. Il servizio CUA continua a fallire all’avvio: nessuna nuova evidenza browser.

Verifica del comando: sei casi con server HTTP isolato, SDK ufficiale effettivo e processi CLI separati (`node --test scripts/check-connect-configuration.test.mjs`), coprendo anche assenza di scritture/segreti, callback estraneo, issuer discordante e 403 sorgente. Non prova una sorgente operativa reale. Il controllo online non può certificare registrazione del client/callback, catalogo approvato, cliente, licenza o mapping utenti: questi richiedono i rispettivi contratti e il ciclo SSO completo.

## Adozione SDK 0.10.0 — store e adattatori ALORA

Installato il tarball locale 0.10.0 consegnato dall’agente Connect, checksum verificato contro il manifest. Le API 0.9.0 restano compatibili e i 43 controlli HTTP del percorso precedente passano con la nuova dipendenza. Nessuna pubblicazione npm, distribuzione, modifica ai sorgenti Connect o migrazione del suo database operativo. L’errore DNS del registry è stato aggirato usando tarball e cache npm locale.

`common/connect-application.ts` istanzia e riusa ConnectApplication con catalogo ALORA, namespace stabile per ambiente/sorgente/app e store PostgreSQL ufficiale. Gli adattatori in `common/connect-accounts.ts` mantengono nel consumer soltanto verifica legacy, provisioning di dominio e restrizioni locali. Il provisioning usa `transaction.sql` dello store: profilo, binding, audit e consumo del flusso possono essere confermati o annullati nella stessa transazione. Nessuna unione per email; ID, ruoli, permessi, nomi, hash e relazioni esistenti sono conservati. Un account solo Connect riceve un hash casuale inutilizzabile come credenziale nota, non la password provider.

La migrazione additiva ALORA `20261022000000_connect_application_store` contiene lo schema ufficiale SDK 001 (`connect_sdk_schema`, `connect_sdk_records`), rappresentato anche in Prisma. Non viene applicata automaticamente durante login o costruzione del client. Lo schema Connect 012 rimane separato: al controllo il container Connect operativo non conteneva ancora `onboarding_password_recoveries`. Non applicare SQL Connect nel database ALORA.

Nuovo `scripts/check-connect-account-adapters.cjs`: **12 controlli superati su database PostgreSQL temporaneo**, con [report](verification/connect-account-adapters.json). Applica tutte le migrazioni consumer sul database vuoto; verifica rollback reale di scritture dominio/store, preservazione dell’appuntamento e dell’importo, hash/profilo/ruoli invariati, provisioning ripetuto, rifiuto di installazione estranea o email appartenente a un altro ID, creazione Connect-only, isolamento aziendale/personale e sospensione. Il database viene eliminato prima del report passato; il database di prova sorgente non viene modificato. Eseguire con DATABASE_URL del solo barber_security_test e container barber-security-postgres attivo, dopo generate/build API.

La diagnostica CLI online ora invoca direttamente `ConnectApplication.diagnose`: non mantiene più la propria implementazione del protocollo di discovery. Restituisce i quattro controlli tipizzati SDK. Per contratto SDK un 403 può provare la raggiungibilità della sorgente ma **non** l’autorizzazione della persona, che resta `not_checked`. I sei casi CLI sono aggiornati a questa distinzione; non attestano client, licenza o associazione operativi.

Verifiche consumer: 125 test/27 suite, build API e admin, lint, validazione Prisma, sei casi diagnostici e 43 controlli HTTP con provider simulato superati. **Il passaggio degli handler HTTP di login/pratiche/callback/sessione alla facciata non è ancora effettuato**: il percorso operativo rimane quello precedente compatibile, non una seconda implementazione SDK dichiarata definitiva. Prossimo intervento: collegare handler e cookie/origine effettiva, integrare nextAction e nuova password distinta nella modale, rimuovere protocollo/rotazione provider duplicati, poi ripetere i collaudi end-to-end del consumer. Browser e accettazione operativa restano aperti.
