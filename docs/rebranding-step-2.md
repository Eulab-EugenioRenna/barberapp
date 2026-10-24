# ALORA — Step 2: identità e compatibilità

Aggiornamento del 24 ottobre: per richiesta dell’utente il service worker è ora network-only, cancella le cache precedenti e non offre fallback offline. Nginx usa no-store. I confronti con il worker precedente nelle sezioni seguenti descrivono la verifica storica del rebranding, non la policy di cache corrente.

Stato al 21 ottobre 2026: implementazione locale verificata tramite build, test, asset esportati e risposte HTTP. Non rilasciata in produzione. Il collaudo visivo e installativo nel browser resta aperto: il browser provider non è disponibile e il servizio Computer Use non si avvia. Il controllo dell’icona PNG è stato effettuato visualmente.

## Identità applicata

Il nome del prodotto è **ALORA by EULAB**, rappresentato nel marchio come **alora** minuscolo. Il simbolo è estratto da `alora logo.svg`, fornito dall’utente: i 14 tracciati originali sono conservati, separati dalla vecchia scritta e dalla tavola sovradimensionata. La palette del riferimento usa lime `#88bd39`, verde scuro `#1e3425` e avorio `#f4f8ec`. L’icona app usa il simbolo bianco su lime; il marchio su fondo scuro usa la sola scritta bianca; la variante corporate usa scritta lime e firma grigia “by EULAB”. Il componente Angular rende scritta e firma direttamente in HTML, con Inter locale nei pesi 600 e 400. Il marchio dell’azienda resta distinto e mantiene nome, logo e palette del tenant. Una tavola di confronto è disponibile in `apps/web-admin/public/brand-preview.html`.

Sono aggiornati titoli, descrizioni e favicon delle applicazioni, manifest PWA, banner d’installazione, icone normali e maskable, titolo Swagger, risposta radice API e default delle notifiche email. Le impostazioni SMTP esplicite degli ambienti esistenti restano prioritarie; un `SMTP_FROM_NAME` configurato con il nome precedente va aggiornato nella configurazione dell’ambiente al rilascio. Le notifiche storiche non vengono riscritte.

Tipografia del marchio: Inter Regular e SemiBold inclusi negli asset, con licenza OFL allegata; nessuna dipendenza dal font installato sul dispositivo. Su richiesta successiva dell’utente, Inter è anche il font dell’intera UI: il file variabile locale copre tutti i pesi usati nei titoli, nei moduli e nei controlli. Sono rimosse sia le importazioni CSS sia i link HTML a Google Fonts; build e visualizzazione non dipendono da quei download. La resa del font disponibile può variare fra sistemi operativi e richiede il collaudo visivo previsto.

## Identità applicata alla UI generale

Il tema condiviso `libs/shared/brand/src/theme.css` definisce colori, font e superfici delle due applicazioni: fondo avorio, pannelli bianchi, navigazione e superfici scure verde foresta, accenti e azioni principali lime. I titoli usano Inter come il testo operativo; sono rimossi i vecchi font decorativi e gli sfondi arancio/verde sfumati della shell. Calendario, selettori, modali e Quick Order seguono la stessa palette, preservando i colori semantici degli stati e quelli configurati per servizi e professionisti.

Le azioni lime hanno testo verde scuro (contrasto 5,97:1); il testo secondario grigio su avorio misura 5,82:1 e l’accento testuale usa una variante più scura del lime, 5,41:1. Questi sono controlli delle coppie principali, non un collaudo completo di accessibilità nel browser. Le personalizzazioni di palette, logo e copertina dei tenant restano prioritarie nel booking; i soli fallback visivi diventano ALORA. Non sono riscritti colori salvati o dati aziendali.

Le build ottimizzate admin e booking, lint e controlli degli asset serviti passano dopo l’applicazione del tema. Il servizio Computer Use continua a non avviarsi: la verifica visiva della UI generale resta da eseguire sul browser disponibile all’utente.

## Contratti preservati

Non sono rinominati URL `/admin/`, `/booking/`, `/api/`, route hash o endpoint. L’identità dell’installazione PWA (`id`, `scope`, `start_url`) e gli shortcut conservano gli stessi valori. I percorsi delle icone, il nome e lo scope del service worker e il namespace storico della cache sono conservati. Il codice operativo del worker è identico alla versione precedente, incluso il divieto di memorizzare le API; resta la coda che differisce il reload in presenza di modali.

Non cambiano database, schema applicativo per effetto del rebranding, volumi, reti, nomi dei servizi Docker, ID, slug esistenti, email dei profili o chiavi Local Storage. I nomi tecnici `barber-*`, `@barber/*` e il nome privato del package restano compatibili. I nuovi tenant demo mostrano il nome ALORA; i tenant preesistenti non sono rinominati.

L’unica modifica alla catena di avvio Docker rimuove il seed distruttivo automatico, come descritto nel rapporto dello Step 1. Nessuna migrazione dati è necessaria per il rebranding; la migrazione delle sessioni dello Step 1 resta distinta.

## Asset riproducibili

Gli SVG e i PNG sono generati dallo stesso disegno vettoriale tramite AppKit, senza dipendenze di rete o nuovi pacchetti. Il generatore legge i tracciati del simbolo da `alora logo.svg` e usa la stessa geometria per SVG e PNG; i colori esportati sono sRGB. Il file maskable ha sfondo pieno e simbolo all’interno dell’area centrale sicura. I favicon hanno un ingrandimento ottico per la leggibilità.

Su macOS, dalla radice del repository:

```sh
npm run brand:icons
```

Il comando genera SVG standard/maskable, PNG 16, 32, 180, 192 e 512 px e il maskable 512 px. Gli asset prodotti sono tracciati: le build Linux non devono eseguire Swift.

## Evidenze

- `npm run build` standard: API, admin e booking ottimizzati superati, senza configurazioni temporanee per i font.
- 74 test automatici superati, inclusi i quattro casi della coda PWA e i sei casi del rinnovo sessione.
- 89 controlli HTTP di sicurezza e regressione su PostgreSQL/Redis isolati: superati dopo il rebranding.
- Controllo bootstrap su database isolato: utenti e tenant preesistenti identici dopo due esecuzioni; account nuovi idempotenti; password assenti dai log; reset incompleto rifiutato prima delle cancellazioni.
- Controllo HTTP degli HTML e delle icone serviti sotto entrambi i prefissi, metadati Swagger e radice API: superato.
- Confronto con Git: identità PWA e shortcut invariati; worker operativo identico; risorse Compose identiche tranne la rimozione del seed automatico.
- Dimensioni PNG confrontate con quelle dichiarate nel manifest: corrette. Regenerazione ripetuta degli asset: impronte identiche.

Restano aperti il collaudo browser di login/agenda/clienti/Quick Order, la verifica visiva desktop e mobile, installazione e aggiornamento di una PWA già esistente, e il rilascio su copia verificabile della produzione. I risultati HTTP e di compilazione non costituiscono queste accettazioni. Nessun ambiente di produzione è stato modificato.

Il prossimo dominio è il catalogo delle funzioni Connect (Step 3), dopo presentazione del risultato e autorizzazione prevista da `evolve.md`.
