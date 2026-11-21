# ALORA by EULAB

Piattaforma SaaS multi-azienda per attività Beauty & Wellness: agenda, prenotazione pubblica, clienti, squadra, servizi, Quick Order, vendite, report e notifiche. Il monorepo comprende due applicazioni Angular 18, API NestJS 10, Prisma/PostgreSQL, Redis/BullMQ e Nginx.

## Sicurezza e stato dell’evoluzione

Lo Step 1 del piano ALORA introduce sessioni locali revocabili, isolamento delle modifiche per azienda, autorizzazioni transitorie e audit delle mutazioni. I vecchi token richiedono un nuovo login, senza cambiare account o password. I provider di pagamento simulati sono disabilitati.

Vedi [sicurezza e migrazione](docs/security-step-1.md), [rebranding e compatibilità](docs/rebranding-step-2.md) e [roadmap di evoluzione](docs/evolution-roadmap.md). Ogni dominio procede con implementazione e verifica separate dall’accettazione in produzione.

## Funzioni operative

- CRUD di clienti, servizi, prodotti, professionisti e orari, con paginazione e ricerca.
- Agenda interna, disponibilità, prenotazione pubblica e gestione delle conferme.
- Quick Order misto di prodotti e servizi, assegnazione dell’esecutore per riga, modifica ed eliminazione degli ordini.
- Report con filtri, attività e aggiornamenti; clienti condivisi nell’azienda.
- Code di notifiche, preferenze, template, inbox, SMTP e webhook.
- Sessioni revocabili, controlli di accesso per azienda e persona, audit delle mutazioni e agenda personale transitoria.
- PWA installabile con aggiornamento differito mentre sono aperti modali.

SSO Connect è integrato; gli step 5 (Squadra e agenda personale) e 6 (profilo e sicurezza personale) hanno una [chiusura tecnica documentata](docs/chiusura-step-5-6.md). Le verifiche account sono rinviate su richiesta dell’utente, distinte dall’accettazione di produzione. Sedi/settori, conto unico, registro dei pagamenti e magazzino sono implementati localmente. Anche dashboard, console WhatsApp e [promemoria/azioni cliente](docs/appointment-automations-workflow-step-12.md) sono installati nel Docker locale; le accettazioni provider, dispositivi e commerciali restano separate. I provider di pagamento simulati restano disabilitati.

## Local Setup

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate
npm run serve:api
npm run serve:admin
npm run serve:public
```

## Docker: build e aggiornamento

Compose esegue i frontend compilati con Nginx e l'API compilata con Node,
senza server Angular di sviluppo, watch mode o bind mount dei sorgenti.
I tre target usano `docker/app.Dockerfile`: la fase condivisa `deps` contiene
`node_modules` ed è riutilizzata dalla cache Docker finché `package.json` e
`package-lock.json` non cambiano. Anche i download npm restano nella cache
BuildKit; il tarball SDK Connect è un ulteriore input della fase `deps`. Non usare `--no-cache` per gli aggiornamenti ordinari.

Primo avvio:

```bash
docker compose up -d --build
```

Dopo ogni modifica ai sorgenti:

```bash
./scripts/update.sh
```

Lo script compila prima le immagini, poi ricrea soltanto API e frontend e
ricarica Nginx. Se la build fallisce, i container correnti restano in servizio.
Per riavviare senza modifiche basta `docker compose up -d`.

I volumi `postgres_data`, `redis_data` e `uploads_data` mantengono gli stessi
nomi e contenuti. Lo script non ferma PostgreSQL e non rimuove volumi.
I vecchi volumi di sviluppo sono conservati, ma non montati nell'app.
Non usare `docker compose down -v` o `docker volume prune` su questa installazione.

All'avvio l'API applica soltanto le migrazioni Prisma mancanti tramite il
bootstrap esistente; non esegue reset né seed automatici. Il bootstrap conserva
anche il riconoscimento delle installazioni legacy e si ferma su stati sconosciuti.
La generazione del client Prisma avviene nella build. Il seed amministrativo e la
creazione della demo restano comandi espliciti descritti sotto.

La build include il tarball SDK Connect già approvato per ALORA. Per il trasporto
Connect locale, il file `.env` usa
`COMPOSE_FILE=docker-compose.yml:docker-compose.connect-local.yml`; l'override monta
soltanto il certificato CA nel container API, senza includerlo nelle immagini,
e imposta `NODE_ENV=development` per mantenere i callback HTTP su localhost.
L’immagine di base mantiene `NODE_ENV=production`.
Il merge dei sorgenti non ricrea i container già avviati: il passaggio dal vecchio
watch mode al runtime compilato avviene al successivo aggiornamento esplicito.

La porta locale è configurabile con `ALORA_HTTP_PORT` (default `53020`); aggiorna anche `APP_ORIGIN` se la cambi. Non occorrono processi Node sull’host.

## Accesso unico via Nginx

- Admin: `http://127.0.0.1:53020/admin/`
- Public booking: `http://127.0.0.1:53020/booking/<tenant-slug>`
- API: `http://127.0.0.1:53020/api/`
- Swagger: `http://127.0.0.1:53020/api/docs`

PostgreSQL, Redis, SMTP/MailHog, le app Angular e l'API sono raggiungibili
solo dalla rete Docker `app`; l'unico endpoint pubblicato sull'host è Nginx.

## Dataset demo completo e mantenimento

`scripts/create-demo-account.ts` crea un account demo **completo** su un database
reale, in modo **idempotente e non distruttivo**: aggiunge un nuovo tenant con
servizi, prodotti, collaboratori (con orari), clienti, appuntamenti, ordini,
abbonamento e coda conferme, senza toccare altri tenant o dati esistenti.

Prima che il tenant esista, lancia (dentro il container API, che ha gia
`DATABASE_URL`):

```bash
docker compose exec api node dist/scripts/create-demo-account.js
```

Se lanciato due volte con lo stesso slug non cambia nulla. Configura `DEMO_OWNER_PASSWORD` nel solo file locale `.env`: le password non vengono stampate. Con il runtime compilato la creazione della demo è un comando esplicito anche in locale. `prisma/seed.ts` con `SEED_DEMO=1` usa lo stesso generatore completo, evitando dataset duplicati.

La demo segue lo schema attuale: squadra con turni, servizi, prodotti, clienti, agenda, vendite con righe e attribuzioni, conferme e abbonamento. Ogni evoluzione di questi domini deve aggiornare `scripts/create-demo-account.ts`, unica sorgente del dataset. Il generatore crea una demo assente; non applica aggiornamenti impliciti a una demo modificata dall’utente. Il reset resta esplicito e confermato.

Il profilo demo è un owner locale legacy: la creazione dei dati non lo approva né lo collega automaticamente a Connect. L’accesso al gestionale segue il gate Connect corrente; il booking pubblico può essere verificato subito.

Personalizzazione tramite variabili d'ambiente:

| Variabile | Default | Note |
| --- | --- | --- |
| `DEMO_TENANT_NAME` | `ALORA Demo Studio` | Nome del tenant |
| `DEMO_TENANT_SLUG` | `demo-barber-studio` | Deve essere unico |
| `DEMO_PUBLIC_DOMAIN` | – | Dominio pubblico opzionale (unico) |
| `DEMO_OWNER_EMAIL` | `demo@barber.test` | Login owner |
| `DEMO_OWNER_PASSWORD` | obbligatoria | Solo nel file locale `.env`; mai stampata |
| `DEMO_OWNER_FIRST_NAME` | `Demo` | |
| `DEMO_OWNER_LAST_NAME` | `Owner` | |
| `DEMO_TIMEZONE` | `Europe/Rome` | |

Per preparare il catalogo iniziale usa `npm run seed:platform-demo` esplicitamente. `PLATFORM_ADMIN_EMAIL` e `PLATFORM_ADMIN_PASSWORD` nel file locale `.env` consentono di creare un amministratore solo se non esiste già. Gli account esistenti non vengono modificati. Il tenant dimostrativo di questo seed viene creato solo con `SEED_DEMO=1`; i suoi slug e indirizzi legacy restano compatibili.

Reset (cancella e ricrea **solo** il tenant demo identificato dallo slug):

```bash
DEMO_RESET_CONFIRM=yes npm run demo:create -- --reset
```

`npm run demo:create -- --help` mostra tutte le opzioni.

## Admin PWA e mobile

L'admin e installabile come PWA (`apps/web-admin/public/manifest.webmanifest`).

La PWA usa **solo la rete, senza cache offline**. Il service worker
(`apps/web-admin/public/service-worker.js`) gestisce esclusivamente eventi push
e clic sulle notifiche: non intercetta le richieste HTTP e non conserva risposte.
Prima dell’avvio dell’app viene aggiornato il worker e vengono eliminate le cache
storiche, mantenendo sessione e sottoscrizioni push. Nginx invia `Cache-Control: no-store`. Senza rete, pagine e API non hanno fallback. Installazione e manifest
restano disponibili. Dettagli e limiti del collaudo: [PWA remota](docs/pwa-remote-only.md).

Quando viene pubblicato un nuovo deploy, l'app confronta il build in esecuzione
con `index.html` remoto, elimina eventuali cache storiche e si ricarica
automaticamente. Se e aperto un modale, il refresh resta in coda fino alla
chiusura dell'ultimo modale, cosi non interrompe un'operazione in corso.

Perche l'invalidazione funzioni:

- l'admin e compilato con `outputHashing: "all"`, quindi i bundle hanno nomi
  con hash e cambiano ad ogni build;
- Nginx non mette in cache `index.html`, `service-worker.js` e
  `manifest.webmanifest` (`docker/nginx.conf`).

Su mobile la shell usa `100dvh`, rispetta le safe area del dispositivo, espone
una bottom navigation con le sezioni principali e impedisce lo zoom automatico
di iOS sui campi di input.

## Notes

This is a production-oriented foundation, not the complete SaaS. The API now includes a Redis-backed notification pipeline with BullMQ, tenant/user notification preferences, a notification inbox center, SMTP/webhook/in-app providers, and appointment/public-booking event triggers.

### Sedi e settori

Lo [Step 7](docs/locations-sectors-step-7.md) introduce sedi, settori, appartenenze operative, aperture e chiusure, risorse e attribuzione storica di appuntamenti e righe di vendita. La configurazione è in `/admin/#/locations`, con le nuove funzioni esplicite `locations.read` e `locations.manage`; il catalogo pubblicato non concede ruoli. [Verifiche e confini](docs/verification/locations-sectors-step-7.json). Il conto unico, i prezzi/IVA e il magazzino restano nei passi successivi.

#
### Conto operativo unico — Step 8

Agenda e cassa condividono la stessa riga del conto. Il booking apre un conto non pagato; la cassa lo salva aperto o registra la vendita conservando gli ID. Migrazione e collaudi locali: [verbale](docs/operational-order-step-8.md), [evidenze](docs/verification/operational-order-step-8.json). Acconti e saldi puntuali appartengono allo Step 10.

## Catalogo delle funzioni Connect

Il registro ALORA associa 32 funzioni alle operazioni API e alla UI, con matrice versione 7. Configurare `ALORA_CONNECT_APP_ID` con l’ID registrato su Connect per esporre `/.well-known/eulab-connect.json` (anche sotto `/admin/` tramite Nginx). La pubblicazione non assegna licenze o ruoli. Vedere [risultati e verifiche dello Step 3](docs/function-catalog-step-3.md), [aggiornamenti degli step 5 e 6](docs/chiusura-step-5-6.md) e [contratto di onboarding richiesto a Connect](docs/connect-onboarding-contract-request.md).

### Accesso Connect e migrazione assistita

L’accesso operativo richiede Connect. ALORA usa una sola facciata SDK, ora **candidata 0.12.0-rc.2 installata localmente** (flusso SSO adottato con 0.10.0/schema Connect 013): presenter tecnico prima dell’integrazione, verifica locale e modale obbligatoria, richiesta sugli endpoint esistenti, approvazione amministrativa e sincronizzazione server della configurazione SSO. Nessun intake parallelo o accesso gestionale locale. I profili vengono collegati/provisionati dopo SSO verificato, senza copia della password provider o unione per email. Presenter configurato nel `.env`; il collaudo consumer locale è stato autorizzato ed eseguito nei limiti descritti nello Step 5. Vedi [istruzioni e limiti](docs/auth-flow-step-4.md), [stato Step 4](docs/sso-step-4.md). La 0.10.0 npm era la distribuzione precedente; la nuova creazione delegata richiede API Connect aggiornata e schema 014.

Per individuare subito i problemi di configurazione, dopo `npm run build:api` eseguire `npm run connect:check`. Legge il `.env` locale e mostra soltanto stato e nomi delle variabili mancanti. `npm run connect:check -- --online` delega a ConnectApplication.diagnose la discovery OIDC e un lookup sorgente con indirizzo QA casuale riservato: non crea utenti o pratiche. Il report distingue configurazione, discovery, sorgente e autorizzazione `not_checked`; una sorgente raggiungibile non certifica licenze, associazioni o login completo. La configurazione operativa attuale è ancora da fornire; nessun hostname pubblico o segreto viene inserito automaticamente.

Lo store ufficiale e gli adattatori ALORA sono collegati agli handler HTTP. I token provider restano nello store SDK; le sessioni opache ALORA mantengono compatibilità con la UI. Le migrazioni consumer `20261022000000_connect_application_store` e `20261022010000_connect_sdk_session_bridge` sono additive. Il server Connect richiede separatamente le proprie migrazioni: il Docker locale attuale è verificato a schema 014. Le vecchie sessioni del consumer richiedono un nuovo accesso; profili, password e dati rimangono invariati.

## SDK Connect: riferimenti online

Pacchetto ufficiale: [@eulab/connect su npm](https://www.npmjs.com/package/@eulab/connect). Codice e guida: [SDK nel repository Connect](https://github.com/Eulab-EugenioRenna/connect/tree/main/packages/sdk). Gli ingressi usati dal backend sono `@eulab/connect/application` e `@eulab/connect/server`.

ALORA usa **la candidata `@eulab/connect@0.12.0-rc.2` da `vendor/eulab-connect-0.12.0-rc.2.tgz`**. `npm ci` e Docker installano il tarball con integrità nel lockfile; installazione offline e contratti consumer verificati. Il pacchetto include deleghe revocabili, webhook e ritiro durevole; [integrazione e limiti](docs/appointment-automations-workflow-step-12.md). Nessuna pubblicazione npm o distribuzione in produzione eseguita. La precedente candidata locale 0.11.0 e i relativi collaudi team restano documentati nello [Step 5](docs/team-step-5.md); il passaggio al registry e l’accettazione del runtime Connect reale restano distinti.

### Prezzi, IVA e magazzino — Step 9

Calcolo decimale e anteprima server, prezzi netti/lordi e storici immutabili, IVA acquisto/vendita indipendenti, giacenze per sede, movimenti idempotenti, costo medio ponderato, consumi dichiarati, resi e trasferimenti. Dati legacy riconciliati senza stock o aliquote inventati. [Verbale](docs/pricing-inventory-step-9.md) e [verifiche locali](docs/verification/pricing-inventory-step-9.json). Le funzioni nuove richiedono concessione esplicita; gli incassi puntuali sono lo Step 10.

### Prenotazioni e incassi — Step 10

Prenotazione multipla, conto unico, cassa, acconti/saldi, metodi misti e rimborsi sono implementati e installati nel Docker locale. Comandi idempotenti, riconciliazione storica e recupero dopo reload verificati su PostgreSQL e browser isolati. [Chiusura tecnica e limiti](docs/booking-payments-step-10.md), [evidenze](docs/verification/payment-ledger-step-10.json).


### WhatsApp, promemoria e azioni cliente — Step 11/12

Nella pagina WhatsApp: connessione, autorizzazioni separate, policy attivabile esplicitamente, eventi selezionabili, cinque testi con anteprima e monitor. Conferma, richiesta modifica e annullamento sono correlati al conto e al consenso della singola prenotazione; nessuna risposta mantiene la prenotazione. Il runtime locale è aggiornato con nove migrazioni notifiche/automazioni, senza consenso o invii storici inferiti. [Funzionamento e prove](docs/appointment-automations-workflow-step-12.md). Pairing, webhook pubblico e messaggi reali richiedono accettazione separata; account esclusi.

[Dashboard e responsive](docs/dashboard-responsive-step-13.md) sono incluse nelle immagini locali. [Ripristino e stato commerciale](docs/release-readiness-step-14.md) distinguono le prove tecniche dalle accettazioni ancora aperte.


### Immagini Docker runtime-only

Le immagini finali di ALORA e Connect contengono build, eseguibili, dipendenze e asset necessari. L’API ALORA esclude TypeScript, source map, Angular e strumenti di sviluppo; il CLI Prisma resta disponibile per le migrazioni e il comando demo è compilato. Il controllo ripetibile è `node scripts/verify-runtime-images.mjs`. [Contenuto, prove e passaggio locale](docs/docker-runtime-only.md).
