# Step 3 — Catalogo delle funzioni ALORA

Aggiornamento 25 ottobre: versione 3, 24 funzioni; aggiunta dashboard.personal.values.read con concessione esplicita e perimetro personale. Le note versione 1/2 seguenti sono storiche.

Aggiornamento Step 5: catalogo versione 2, 23 funzioni; aggiunta team.manage con abilitazione esplicita Connect. Le sezioni successive descrivono la baseline versione 1. Vedi [ruoli e squadra](team-step-5.md).

Stato: implementazione locale e prove automatiche/di integrazione isolate eseguite. Nessuna registrazione o concessione su installazioni Connect operative. Collaudo browser e accettazione dell’ambiente di rilascio pendenti.

## Registro e associazione alle operazioni

`apps/api/src/common/function-catalog.ts` è la fonte pura delle capacità, senza import di Angular, Nest o Prisma. Il backend lo importa direttamente; Angular usa l’alias `@barber/shared/functions`. La posizione mantiene invariato l’output `dist/apps/api/main.js` e il packaging esistente. `FunctionKey` è derivato dalle chiavi letterali: riferimenti API e viste utilizzano il medesimo tipo.

`operation-catalog.ts` censisce ogni handler HTTP con una funzione oppure una classificazione esplicita: pubblico, sessione, contesto minimo tenant, piattaforma o provider disabilitato. Il guard rifiuta handler sconosciuti anche per titolare e piattaforma. Il controllo AST della suite confronta tutte le route dei controller con il registro e rileva classificazioni mancanti o rimaste senza handler.

Il catalogo versione 1 espone 22 funzioni operative:

- Agenda: `appointments.read.all`, `appointments.read.own`, `appointments.create`, `appointments.update.all`, `appointments.update.own`.
- Clienti: `clients.read.full`, `clients.manage`.
- Listino: `services.read`, `services.manage`.
- Catalogo prodotti: `products.read`, `products.manage`.
- Squadra e orari: `collaborators.read`, `collaborators.manage`.
- Vendite: `sales.read`, `sales.manage`.
- Report: `dashboard.revenue.read`.
- Impostazioni: `settings.manage`.
- Utenze locali e revoca sessioni: `users.manage`.
- Audit aziendale: `audit.read`.
- Notifiche: `notifications.read`, `notifications.manage`, `confirmations.read`.

Il catalogo non anticipa magazzino, sedi, editor dei ruoli, WhatsApp o pagamenti provider. Le operazioni piattaforma rimangono separate dalle licenze aziendali.

## Compatibilità e autorizzazioni

I permessi persistiti non vengono riscritti. Gli alias da `settings.manage` alle tre capacità notifiche preservano i flussi già autorizzati, senza attribuire impostazioni a chi ha una sola nuova capacità. Ogni funzione legacy contiene una concessione esplicita al titolare (`legacy: true`); la presenza di un ruolo non permette handler non censiti o chiavi sconosciute. Le funzioni aggiunte successivamente non devono ricevere una concessione legacy implicita: l’assegnazione rimane una decisione esplicita.

Il professionista mantiene soltanto lettura e aggiornamento dello stato degli appuntamenti assegnati; i filtri personali e aziendali dello Step 1 rimangono autorevoli. Manager e reception richiedono permessi espliciti. Questa policy è ancora locale e transitoria: non viene descritta come controllo Connect attivo sulle normali richieste ALORA. L’intersezione con licenze e assegnazioni Connect sarà introdotta con SSO/attivazione.

## UI e dati operativi

Navigazione e guard delle pagine usano le funzioni del registro. Chi non ha sezioni abilitate raggiunge una pagina dedicata; l’accesso ai soli prodotti apre il listino mostrando il pannello prodotti. Le principali azioni di modifica dei cataloghi e della cassa sono nascoste con una direttiva di presentazione; l’API controlla indipendentemente il permesso. Drag e spostamenti dell’agenda richiedono `appointments.update.all`. Anche la coda dei conti distingue lettura, registrazione/collegamento vendite e annullamento appuntamenti. Le azioni di creazione rapida richiedono separatamente `clients.manage`, `services.manage` o `products.manage`, sia nei selettori dell’agenda sia in Quick Order; il permesso di vendere non concede la modifica dei cataloghi.

I loader non richiedono cataloghi o report negati: l’assenza di un permesso non viene gestita ignorando un 403 dopo la richiesta. Lo stream dei conti da chiudere parte soltanto con `confirmations.read`.

Due proiezioni minime evitano di concedere `settings.manage` o accesso completo alla squadra per visualizzare l’agenda:

- `GET /tenant/context`: identità, logo, fuso orario, valuta e lingua dell’azienda; niente configurazione pubblica o amministrativa.
- `GET /appointments/context`: servizi e professionisti attivi con identificativi, nomi e disponibilità necessarie al calendario; niente email, telefono o note interne. Richiede lettura dell’agenda aziendale.

## Pubblicazione e versionamento

Configurare `ALORA_CONNECT_APP_ID` con l’ID applicazione realmente registrato su Connect. L’ID è comune alle installazioni ALORA e non proviene da host, query o dati del cliente. Senza configurazione il catalogo risponde 503: nessuna identità viene inventata.

Fonte autorevole Nest: `GET /.well-known/eulab-connect.json`. Nginx espone lo stesso documento tramite i percorsi esatti:

- `/.well-known/eulab-connect.json`
- `/admin/.well-known/eulab-connect.json`
- `/api/.well-known/eulab-connect.json` tramite il proxy API esistente.

Registrare su Connect il percorso appartenente all’installazione, per esempio `/admin/.well-known/eulab-connect.json` se `basePath` è `/admin`. Il documento include solo `schemaVersion`, `appId`, `version`, `functions` e i metadati consentiti dal contratto; nessun alias o metadato di policy locale. Header `Cache-Control: no-cache` e JSON senza redirect.

Per aggiungere una funzione: dichiarare la capacità e il suo ambito reale, associare handler e azioni UI, incrementare `FUNCTION_MATRIX_VERSION`, rivedere lo snapshot e i test negativi, quindi sincronizzare su Connect. L’importazione non crea ruoli, acquisti o assegnazioni. Il titolare deve poter scegliere la funzione nel configuratore dei ruoli Connect quando disponibile, entro licenza e delega. Rimozioni e reintroduzioni non devono ripristinare permessi ritirati.

## Evidenze ottenute

- Suite: 88 test, 22 suite e snapshot del documento. Inclusi copertura degli handler, chiavi sconosciute negate, alias, rotte UI e assenza di richieste secondarie vietate.
- 97 controlli HTTP su PostgreSQL isolato, inclusi accesso agenda senza impostazioni/clienti/listino/report, isolamento e regressioni dello Step 1.
- Build API, admin, pubblica e lint eseguiti; dettagli dell’ultima verifica sono riportati nel risultato del lavoro.
- `scripts/check-function-catalog.cjs`: avvia un’API di prova e un container Nginx separato usando la configurazione del progetto con soli upstream di test. Verifica GET reale dei tre percorsi, JSON, header, assenza di redirect e identità server invariabile.
- `scripts/check-connect-function-catalog.mjs`: usa in sola lettura il checkout Connect e il suo harness con database PGlite in memoria. Il CatalogReader Connect esegue un GET reale attraverso Nginx; API di importazione, validatore e SDK accettano ALORA. Ripetizione stabile, modifiche a pari versione e regressioni rifiutate; una funzione sintetica aggiunta resta negata senza assegnazione/licenza. OIDC è simulato: non è un login con provider reale. Il test usa gli artefatti compilati presenti nel checkout per l’API e i sorgenti del validatore/SDK/reader.
- Il servizio di controllo browser restituisce `Sky Computer Use service startup request failed`: nessuna accettazione visiva dichiarata.

Per ripetere le prove usare esclusivamente il database usa-e-getta `barber_security_test`; i due script API rifiutano altri nomi di database. `check-function-catalog.cjs` richiede `CATALOG_NGINX_IMAGE` con un’immagine Nginx locale e, opzionalmente, `CONNECT_CHECKOUT` con un checkout già compilato. Il test Connect non carica `.env`, non contatta l’istanza corrente e non modifica il repository Connect. Container e processi avviati dalla prova vengono chiusi al termine.

## Migrazioni e passi successivi

Nessuna migrazione di database introdotta da questo step. Nessuna modifica di utenti, password, ruoli, licenze o dati operativi esistenti.

La richiesta aggiornata per l’onboarding a pulsante unico e per la delega è in `connect-onboarding-contract-request.md`. Le modifiche Connect sono in carico all’utente; il checkout non viene modificato da questo lavoro. Il catalogo è predisposto all’integrazione, ma SSO, provisioning tenant, attivazione degli utenti e configuratore dei permessi non sono implementati da questa milestone.
