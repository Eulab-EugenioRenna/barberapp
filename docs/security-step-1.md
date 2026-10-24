# ALORA — Step 1: sicurezza del sistema esistente

Stato: implementato e verificato in locale il 21 ottobre 2026. Non rilasciato in produzione. Il rebranding è documentato separatamente nello [Step 2](rebranding-step-2.md). Questa fase applica il piano di evoluzione approvato, preservando i modelli e gli ID operativi esistenti.

## Contratto transitorio

- Login e signup mantengono `accessToken`, `refreshToken` e `user`, aggiungendo `expiresAt` ISO. `me` restituisce identità, permessi e collegamento operativo, senza credenziali.
- Access token e refresh token sono distinti, casuali a 256 bit. PostgreSQL conserva esclusivamente SHA-256, scadenze, famiglia e stato della sessione.
- Accesso: 15 minuti. Refresh: massimo 7 giorni dall'accesso originale, senza estensione a ogni rinnovo. Il rinnovo invalida il precedente access token e consuma il refresh. Le righe consumate restano disponibili per rilevare riutilizzi.
- Un refresh riutilizzato revoca l'intera famiglia. Transizioni concorrenti sono serializzate con lock PostgreSQL; un doppio refresh determina una sola emissione e la successiva revoca della famiglia.
- Logout revoca tutta la famiglia anche con access token scaduto. `DELETE /users/:id/sessions` revoca le sessioni di una persona della stessa azienda per utenti autorizzati alla gestione degli utenti. La sospensione aziendale revoca le sessioni; riattivare l'azienda richiede nuovi accessi.
- Ogni richiesta ricontrolla stato della persona, azienda, ruolo e permessi. Lo stream ricontrolla accesso e permessi ogni 15 secondi.
- I token precedenti `barber-session:<id>` sono rifiutati. Gli utenti devono accedere nuovamente; account e password non sono migrati o reimpostati.
- Angular condivide il rinnovo fra richieste e, quando Web Locks è disponibile, fra schede. I token locali persistono nelle chiavi esistenti, con chiavi aggiuntive per refresh/scadenza. Non sono inviati a URL esterni. Una mutazione che riceve 401 non viene ripetuta: il rinnovo prepara la successiva azione esplicita. Il logout durante il rinnovo non ripristina la sessione.

## Policy locale

| Persona | Ambito |
| --- | --- |
| Titolare | Operazioni della propria azienda |
| Amministratore di piattaforma | Amministrazione di piattaforma, elenco utenti e audit; nessun accesso alle normali operazioni aziendali |
| Professionista | Agenda assegnata, dettaglio e stato dei propri appuntamenti; nessuna cassa, dashboard aziendale, anagrafica generale o configurazione |
| Manager / reception | Solo operazioni autorizzate da `User.permissions` |
| Cliente | Nessun accesso alle API amministrative |

La nuova vista `/my-agenda` permette al professionista di consultare i propri appuntamenti senza caricare cataloghi o report aziendali. Non anticipa la dashboard personale prevista nello Step 5.

I permessi transitori per manager/reception sono:

- `services.read` / `services.manage`, `products.read` / `products.manage`, `collaborators.read` / `collaborators.manage`;
- `clients.read.full` / `clients.manage`;
- `appointments.read.all`, `appointments.create`, `appointments.update.all`;
- `sales.read` / `sales.manage`, `dashboard.revenue.read`, `settings.manage`, `users.manage`, `audit.read`.

Disponibilità richiede `appointments.read.all`; notifiche e configurazione pagamenti richiedono `settings.manage`. Non vengono assegnati nuovi permessi implicitamente agli account esistenti. La gestione configurabile dei ruoli e Connect resta nelle milestone successive.

## Isolamento e risposte

Update e delete dei cataloghi vincolano direttamente ID e azienda senza riassegnare `tenantId`. Appuntamenti, righe dei conti, servizi/prodotti associati e risorse verificano l'azienda dei riferimenti. I controlli precedono accesso alla cache e scritture. Le cache dell'agenda separano ambito personale, aziendale e intervallo; disponibilità pubblica e interna non condividono risultati; la cache del dettaglio piattaforma usa una nuova versione per evitare risposte legacy con password hash.

I DTO validano login, signup, refresh, scritture dei cataloghi, appuntamenti e orari annidati. Le scritture dei conti mantengono la normalizzazione e le verifiche specifiche esistenti. Gli errori Prisma di vincolo e validazione diventano risposte prive di dettagli interni. Gli utenti sono proiettati esplicitamente anche nell'export di piattaforma; le configurazioni private dei provider non sono restituite dalle API di configurazione.

L'import di piattaforma rifiuta ID di altre aziende, riferimenti estranei e scritture ORM annidate. La sostituzione e l'import avvengono nella stessa transazione: un payload invalido non cancella preventivamente i dati. Il reset conserva gli audit precedenti.

Gli endpoint simulati dei pagamenti non producono intenti commerciali: restituiscono 501. La registrazione gestionale delle vendite esistenti resta disponibile.

Login, logout, riutilizzo del refresh e mutazioni autorizzate producono audit senza corpi delle richieste/risposte o token. Il middleware di audit registra identificativi e operazione dopo il successo del controller; l'audit delle mutazioni non è ancora un outbox transazionale insieme alla scrittura di dominio. Non si deve ritentare automaticamente una scrittura che ha avuto esito incerto.

## Avvio e account dimostrativi

La verifica successiva dell’avvio ha rilevato un seed automatico che ricreava il tenant demo e reimpostava un amministratore con credenziali predefinite. È stato rimosso dalla catena di avvio Compose. Il seed esplicito conserva account e tenant esistenti, non modifica le loro password o permessi e crea un amministratore solo con password configurata nel file locale `.env`. Il tenant demo del seed richiede `SEED_DEMO=1`; lo script `demo:create` mantiene l’eventuale reset esplicito e confermato, ma rifiuta credenziali mancanti prima di cancellare dati. Nessuna password viene stampata.

`check-bootstrap-security.cjs` ha verificato su database isolato la conservazione integrale di utenti e aziende dopo esecuzioni ripetute, l’idempotenza della creazione esplicita e il rifiuto di un reset con credenziali incomplete prima delle cancellazioni. Non è stato eseguito alcun reset su dati esistenti.

## Migrazione e riconciliazione

La sola modifica strutturale è la tabella additiva `LocalSession`, con relazione a `User`. Nessuna tabella operativa è rinominata o riscritta.

Con `DATABASE_URL` già impostato sull'ambiente autorizzato, dopo backup e sospensione di scritture, worker e invii:

```sh
node scripts/security-session-migration.cjs analyze /percorso/protetto/checkpoint.json
ALORA_MIGRATION_WRITES_FROZEN=1 node scripts/security-session-migration.cjs apply /percorso/protetto/checkpoint.json
node scripts/security-session-migration.cjs verify /percorso/protetto/checkpoint.json
```

L’analisi blocca anche riferimenti storici fra aziende diverse (agenda, conti, cataloghi, identità operative e destinatari delle notifiche). Eventuali anomalie richiedono riconciliazione esplicita prima di attivare la release; non vengono corrette automaticamente.

Il checkpoint registra conteggi e impronte del contenuto di tutte le tabelle aziendali, inclusi utenti, prezzi, ID e relazioni; non salva dati personali o credenziali. Sessioni, audit e cronologia Prisma sono esclusi dalla quadratura aziendale. Il comando rifiuta checkpoint di altri database o dati modificati fra le fasi. `apply` usa il bootstrap Prisma esistente ed è ripetibile; `analyze` non sovrascrive checkpoint. Non riaprire le scritture con riconciliazione fallita.

I nuovi checkpoint sono versionati (`snapshotVersion: 2`) e conservano la lista delle colonne originarie: nuove colonne e tabelle additive non alterano la quadratura dei dati precedenti. L’impronta non assume una chiave `id` su ogni tabella. I checkpoint storici vengono verificati con il loro algoritmo originale, senza reinterpretare le impronte. `ALORA_MIGRATION_WRITES_FROZEN=1` è una dichiarazione dell’operatore, non sospende automaticamente i processi: scritture, worker e invii devono essere effettivamente arrestati prima dell’analisi.

Verifica effettuata su PostgreSQL 17 isolato: upgrade da schema senza sessioni ma con dati, quadratura invariata, seconda applicazione senza modifiche, backup `pg_dump -Fc` e ripristino su database separato con identiche impronte aziendali. Il database e i volumi del progetto esistente non sono stati modificati.

Rollback: mantenere la tabella additiva e usare una build correttiva che conservi l'autenticazione sicura. La vecchia release può ignorare la tabella a livello strutturale, ma riattivarla reintrodurrebbe i token prevedibili: **non è un rollback di sicurezza accettabile e non è stato collaudato come rilascio**. Prima della riapertura si può ripristinare lo snapshot verificato; dopo nuove scritture serve una correzione compatibile che le preservi. Non eliminare sessioni consumate prima della loro scadenza di refresh.

## Verifica ripetibile

```sh
npm run prisma:generate
npx prisma validate
npm run lint
npm test -- --runInBand
npm run build:api
npx tsc -p apps/web-admin/tsconfig.app.json --noEmit
npx tsc -p apps/web-public-booking/tsconfig.app.json --noEmit
```

Per il controllo HTTP, predisporre un PostgreSQL **di prova** con database `barber_security_test` e Redis isolato. Il comando crea fixture con un suffisso casuale e le lascia nel database di prova, senza pulire dati preesistenti. Non eseguirlo su produzione:

```sh
# DATABASE_URL deve puntare esclusivamente al database di prova.
npm run prisma:deploy
node scripts/check-security-api.cjs
```

L'API del test usa la porta 53019 e Redis locale sulla porta 56389 (override `SECURITY_TEST_PORT` e `SECURITY_REDIS_PORT`). Richiede la build API già prodotta; avvia e arresta solo il processo API di prova. Lo script disabilita l'invio SMTP esterno.

Risultati: 74 test in 18 suite; 89 controlli HTTP più asserzioni su isolamento, dati, concorrenza, storage e audit; lint, build API, schema Prisma e compilazione TypeScript delle due applicazioni superati. Le build Angular ottimizzate superano la compilazione con `optimization.fonts=false` temporaneo, senza modificare la configurazione salvata. La dipendenza esterna dai font è stata rimossa nello Step 2; ora anche la build standard passa.

Restano richiesti prima del rilascio: prova su copia recente della produzione, backup/ripristino dell'ambiente effettivo, verifica del comportamento sulla versione PostgreSQL di destinazione e collaudo browser di login, rinnovo fra schede, agenda, clienti, Quick Order, PWA e stream. La baseline di produzione non è acquisita. Nessuna verifica o modifica Connect/SSO/WhatsApp è inclusa in questa fase.
