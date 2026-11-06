# Barber SaaS

MVP foundation for the PRD in `PRD.md`: a white-label multi-tenant booking SaaS with Angular admin/public apps, NestJS API, Prisma/PostgreSQL, Docker, shared domain types, audit logging, and modules for bookings, services, collaborators, resources, products, sales, notifications, payments, and dashboards.

## Scope Implemented

- NX-style monorepo layout with `apps/` and `libs/`.
- NestJS API scaffold with feature modules and REST endpoints for the PRD's first release surface.
- Prisma schema with tenant-scoped business entities and key indexes.
- Angular admin shell with dashboard, calendar, sidebar, touch-mode action area, and management sections.
- Angular public booking shell with white-label booking stepper.
- Docker Compose for PostgreSQL, Redis, API, and MailHog.

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
BuildKit. Non usare `--no-cache` per gli aggiornamenti ordinari.

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
bootstrap esistente; non esegue reset né seed automatici. La generazione del
client Prisma avviene nella build. Su una nuova installazione il seed iniziale è un'operazione esplicita:

```bash
docker compose exec api npm run seed:platform-demo
```

Per creare un tenant demo separato usa invece il comando della sezione successiva.

## Accesso unico via Nginx

- Admin: `http://localhost:8080/admin/`
- Public booking: `http://localhost:8080/booking/<tenant-slug>`
- API: `http://localhost:8080/api/`
- Swagger: `http://localhost:8080/api/docs`

PostgreSQL, Redis, SMTP/MailHog, le app Angular e l'API sono raggiungibili
solo dalla rete Docker `app`; l'unico endpoint pubblicato sull'host è Nginx.

## Account demo in produzione

`scripts/create-demo-account.ts` crea un account demo **completo** su un database
reale, in modo **idempotente e non distruttivo**: aggiunge un nuovo tenant con
servizi, prodotti, collaboratori (con orari), clienti, appuntamenti, ordini,
abbonamento e coda conferme, senza toccare altri tenant o dati esistenti.

Prima che il tenant esista, lancia (dentro il container API, che ha gia
`DATABASE_URL`):

```bash
docker compose exec api npm run demo:create
```

Se lanciato due volte con lo stesso slug non cambia nulla. Le credenziali e la
password vengono stampate a fine esecuzione.

Personalizzazione tramite variabili d'ambiente:

| Variabile | Default | Note |
| --- | --- | --- |
| `DEMO_TENANT_NAME` | `Demo Barber Studio` | Nome del tenant |
| `DEMO_TENANT_SLUG` | `demo-barber-studio` | Deve essere unico |
| `DEMO_PUBLIC_DOMAIN` | – | Dominio pubblico opzionale (unico) |
| `DEMO_OWNER_EMAIL` | `demo@barber.test` | Login owner |
| `DEMO_OWNER_PASSWORD` | generata | Stampa la password se non impostata |
| `DEMO_OWNER_FIRST_NAME` | `Demo` | |
| `DEMO_OWNER_LAST_NAME` | `Owner` | |
| `DEMO_TIMEZONE` | `Europe/Rome` | |

Esempio su produzione:

```bash
docker compose exec \
  -e DEMO_OWNER_EMAIL=cliente.demo@example.com \
  -e DEMO_OWNER_PASSWORD='UnaPasswordSicura!' \
  api npm run demo:create
```

Reset (cancella e ricrea **solo** il tenant demo identificato dallo slug):

```bash
DEMO_RESET_CONFIRM=yes npm run demo:create -- --reset
```

`npm run demo:create -- --help` mostra tutte le opzioni.

## Admin PWA e mobile

L'admin e installabile come PWA (`apps/web-admin/public/manifest.webmanifest`).

Il service worker (`apps/web-admin/public/service-worker.js`) serve solo
all'installazione: elimina le vecchie cache e non intercetta le richieste.
Nginx serve i file compilati compressi e con `Cache-Control: no-store`.
Non sono previsti fallback offline o salvataggi differiti.

Quando viene pubblicato un nuovo deploy, l'app confronta il build in esecuzione
con `index.html` remoto e mostra il banner "Nuova versione disponibile".
Il pulsante **Aggiorna** ricarica l'app. I bundle admin hanno nomi con hash
che cambiano a ogni build.

Su mobile la shell usa `100dvh`, rispetta le safe area del dispositivo, espone
una bottom navigation con le sezioni principali e impedisce lo zoom automatico
di iOS sui campi di input.

## Notes

This is a production-oriented foundation, not the complete SaaS. The API now includes a Redis-backed notification pipeline with BullMQ, tenant/user notification preferences, a notification inbox center, SMTP/webhook/in-app providers, and appointment/public-booking event triggers.
