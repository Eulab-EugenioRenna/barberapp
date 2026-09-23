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

- `docker compose up` ora esegue automaticamente `prisma generate`, un bootstrap Prisma verificato e `seed:platform-demo` prima di avviare l'API. Il bootstrap crea lo schema da zero su un volume nuovo; su un volume legacy senza cronologia registra soltanto la baseline e poi applica le migrazioni mancanti. Se rileva uno stato non riconosciuto, si ferma senza modificare dati. Non usare `prisma db push --force-reset` su un database con dati.
- Il seed e idempotente: ricrea in modo coerente l'accesso `platform_admin` e il tenant demo vendibile.

## Accesso unico via Nginx

- Admin: `http://localhost:8080/admin/`
- Public booking: `http://localhost:8080/booking/<tenant-slug>`
- API: `http://localhost:8080/api/`
- Swagger: `http://localhost:8080/api/docs`

PostgreSQL, Redis, SMTP/MailHog, le app Angular e l'API sono raggiungibili
solo dalla rete Docker `app`; l'unico endpoint pubblicato sull'host è Nginx.

## Notes

This is a production-oriented foundation, not the complete SaaS. The API now includes a Redis-backed notification pipeline with BullMQ, tenant/user notification preferences, a notification inbox center, SMTP/webhook/in-app providers, and appointment/public-booking event triggers.
