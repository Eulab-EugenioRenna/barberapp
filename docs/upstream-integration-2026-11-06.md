# Integrazione upstream Barber in ALORA — 6 novembre 2026

## Provenienza e recupero

- Stato ALORA iniziale: `9884776`, con 19 commit locali successivi alla base comune `1c6f773`.
- Nuovo commit remoto: `a16a1de` — “Serve compiled apps with cached Docker dependencies and remove PWA caching”.
- Ramo di sicurezza: `backup/alora-before-origin-a16a1de-20261106`.
- Merge locale con entrambi i genitori, senza riscrivere i commit ALORA. Nessun push.

## Cambiamenti integrati e adattamenti

| Area | Risultato |
| --- | --- |
| Ricerca clienti | Ricerca per più termini su nome, cognome, email e telefono; isolamento per tenant conservato. |
| Filtri clienti | Proiezione completa di ID e nomi separata dalla lista paginata. Handler `CustomersController.options` registrato nel catalogo delle operazioni con `clients.read.full`; anche i loader frontend rispettano questo permesso. |
| Richieste concorrenti | Risposte obsolete della ricerca scartate; paginazione simultanea limitata; letture API con timeout di 20 secondi, senza retry delle scritture. Deduplicazione delle letture ALORA conservata. |
| Dashboard e agenda | Periodo giornaliero predefinito, refresh al ritorno online/in primo piano, prevenzione delle sovrapposizioni del refresh automatico e mantenimento dei dati durante il caricamento. |
| PWA | Conservati worker ALORA con push/clic, avvio remoto e aggiornamento differito finché sono aperte modali. Importati controllo aggiornamenti con timeout, esclusione delle verifiche sovrapposte/in background e riconoscimento dei documenti senza script. La sostituzione integrale con worker e banner del vecchio Barber è stata esclusa. |
| Docker | Runtime compilati e dipendenze condivise con cache BuildKit. Aggiunti tarball SDK Connect già in uso, contratti comuni ALORA e font/icone riutilizzati dal booking pubblico. |
| Avvio API | Bootstrap Prisma esistente per le sole migrazioni mancanti; nessun reset o seed automatico. Comandi manuali demo/seed inclusi nell’immagine. |
| Nginx | DNS dinamico per i servizi compilati, `no-store`, 404 per asset mancanti. Conservati route Connect, oscuramento dei log auth, host con porta e porta locale `53020`. Le route Vite non servono al runtime compilato. |
| Connect locale | Override con mount in sola lettura della CA; `NODE_ENV=development` mantiene i callback HTTP su localhost già usati. L’immagine di base conserva `NODE_ENV=production`. |
| Contesto immagine | Conservate esclusioni `.env`, `.git`, `.local` e aggiunte quelle upstream per upload, backup e directory di credenziali. |

Brand, gestione squadra, agenda personale, flussi di autenticazione e SDK non sono stati sostituiti dalle versioni Barber.

Il file preesistente non tracciato `docs/a previous agent produced the plan below.md` è rimasto fuori dal merge.

## Verifiche eseguite

- `npm test -- --runInBand`: **41 suite, 236 test e 1 snapshot superati**.
- `node --test scripts/tests/pwa-network.test.cjs`: **6 test superati** (worker/push, richieste concorrenti, cache HTTP e timeout).
- `npm run lint`: superato.
- `npm run build`: API, admin e booking pubblico compilati.
- `docker compose config --quiet`: configurazione composta valida.
- `docker compose --progress plain build api web-admin web-public-booking`: tre target completati, confermati dalla cronologia BuildKit e dalle immagini generate.
- `sh -n docker/api-entrypoint.sh scripts/update.sh` e `git diff --cached --check`: superati.
- Nginx: sintassi verificata sia nel gateway esistente, senza reload, sia in un container temporaneo.
- Container frontend temporanei: HTML servito con HTTP 200 e `Cache-Control: no-store`; bundle inesistente con HTTP 404; asset ALORA presenti, inclusi quelli del booking.
- Container API temporaneo: file runtime/seed/bootstrap presenti, SDK ESM Connect/Prisma/bcrypt caricabili, `.env` e `.local` assenti dall’immagine.
- Comando temporaneo con il Compose locale: validazione della configurazione Connect e presenza della CA montata, senza login, chiamate provider o query database.

Queste verifiche non costituiscono collaudo operativo o accettazione del login SSO nel nuovo runtime. Lo script `scripts/update.sh` non è stato eseguito: i container del progetto hanno mantenuto i propri ID, senza ricreazione, migrazione o seed. I container temporanei usati per i controlli sono stati rimossi. Il precedente watch mode può rilevare le modifiche ai sorgenti montati; il passaggio ai nuovi runtime compilati richiede un aggiornamento esplicito.
