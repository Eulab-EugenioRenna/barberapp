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

Connect, sedi e settori, conto unico, registro dei pagamenti e magazzino sono previsti nella roadmap. I provider di pagamento simulati restano disabilitati.

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

## Docker Dev Setup

`docker compose` ora e ottimizzato per sviluppo:

- bind mount del workspace locale in `/app`
- volumi persistenti per `node_modules`
- cache persistenti `npm` e `.angular`
- volume `dist` persistente per evitare rebuild completi inutili
- volume persistente `uploads` per logo e cover tenant su filesystem
- API e frontend avviati in watch mode dentro i container

Primo avvio:

```bash
docker compose up -d --build
```

Poi, durante lo sviluppo normale, basta:

```bash
docker compose up -d
```

Le modifiche ai file locali vengono riutilizzate dai container senza rifare l'immagine ogni volta.

Nota:

- `docker compose up` ora esegue automaticamente `prisma generate` e un bootstrap Prisma verificato prima di avviare l'API. Il bootstrap crea lo schema da zero su un volume nuovo; su un volume legacy senza cronologia registra soltanto la baseline e poi applica le migrazioni mancanti. Se rileva uno stato non riconosciuto, si ferma senza modificare dati. Non usare `prisma db push --force-reset` su un database con dati.
- Compose di sviluppo crea la demo completa prima dell’avvio API (`DEMO_BOOTSTRAP=1`, default). Configura `DEMO_OWNER_PASSWORD` nel `.env`; `DEMO_BOOTSTRAP=0` disabilita la creazione. Se la demo esiste già, ID, profilo, password e dati vengono conservati. Il seed amministrativo resta manuale.

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
docker compose exec api npm run demo:create
```

Se lanciato due volte con lo stesso slug non cambia nulla. Configura `DEMO_OWNER_PASSWORD` nel solo file locale `.env`: le password non vengono stampate. Il Compose di sviluppo richiama lo stesso generatore automaticamente; per produzione resta un comando esplicito. `prisma/seed.ts` con `SEED_DEMO=1` usa lo stesso generatore completo, evitando dataset duplicati.

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
(`apps/web-admin/public/service-worker.js`) non salva né recupera risposte:
usa `fetch` con `cache: "no-store"` e cancella tutte le cache precedenti
all’attivazione. L’app elimina le vecchie cache anche all’avvio. Nginx
invia `Cache-Control: no-store`; senza rete il contenuto non viene sostituito
con copie precedenti. L’installazione PWA resta disponibile.

Quando viene pubblicato un nuovo deploy, l'app confronta il build in esecuzione
con `index.html` remoto, invalida le cache del service worker e si ricarica
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

### Catalogo delle funzioni Connect

Il registro ALORA associa 22 funzioni alle operazioni API e alla UI. Configurare `ALORA_CONNECT_APP_ID` con l’ID registrato su Connect per esporre `/.well-known/eulab-connect.json` (anche sotto `/admin/` tramite Nginx). La pubblicazione non assegna licenze o ruoli. Vedere [risultati e verifiche dello Step 3](docs/function-catalog-step-3.md) e [contratto di onboarding richiesto a Connect](docs/connect-onboarding-contract-request.md).

### Accesso Connect e migrazione assistita

L’accesso operativo richiede Connect. ALORA usa una sola facciata **SDK 0.10.0/schema Connect 013**: presenter tecnico prima dell’integrazione, verifica locale e modale obbligatoria, richiesta sugli endpoint esistenti, approvazione amministrativa e sincronizzazione server della configurazione SSO. Nessun intake parallelo o accesso gestionale locale. I profili vengono collegati/provisionati dopo SSO verificato, senza copia della password provider o unione per email. Presenter configurato nel `.env`; il collaudo è riservato all’utente. Vedi [istruzioni e limiti](docs/auth-flow-step-4.md), [stato Step 4](docs/sso-step-4.md). Nessuna pubblicazione npm.

Per individuare subito i problemi di configurazione, dopo `npm run build:api` eseguire `npm run connect:check`. Legge il `.env` locale e mostra soltanto stato e nomi delle variabili mancanti. `npm run connect:check -- --online` delega a ConnectApplication.diagnose la discovery OIDC e un lookup sorgente con indirizzo QA casuale riservato: non crea utenti o pratiche. Il report distingue configurazione, discovery, sorgente e autorizzazione `not_checked`; una sorgente raggiungibile non certifica licenze, associazioni o login completo. La configurazione operativa attuale è ancora da fornire; nessun hostname pubblico o segreto viene inserito automaticamente.

Lo store ufficiale e gli adattatori ALORA sono collegati agli handler HTTP. I token provider restano nello store SDK; le sessioni opache ALORA mantengono compatibilità con la UI. Le migrazioni consumer `20261022000000_connect_application_store` e `20261022010000_connect_sdk_session_bridge` sono additive. Il server Connect richiede separatamente il proprio schema 012, ora rilevato nel Docker locale. Le vecchie sessioni del consumer richiedono un nuovo accesso; profili, password e dati rimangono invariati.

## SDK Connect: riferimenti online

Pacchetto ufficiale: [@eulab/connect su npm](https://www.npmjs.com/package/@eulab/connect). Codice e guida: [SDK nel repository Connect](https://github.com/Eulab-EugenioRenna/connect/tree/main/packages/sdk). Gli ingressi usati dal backend sono `@eulab/connect/application` e `@eulab/connect/server`.

Questa integrazione usa la candidata locale **0.10.0** tramite tarball versionato in `vendor/`, come specificato nel lockfile. Il collegamento npm identifica il pacchetto ufficiale; non attesta che la candidata sia pubblicata. Prima del passaggio alla distribuzione npm verificare la versione con `npm view @eulab/connect version`, pubblicare la candidata approvata e aggiornare dipendenza e lockfile alla versione esatta. La verifica del registry del 24 ottobre è stata impedita da DNS ENOTFOUND; la dipendenza locale funzionante resta invariata.
