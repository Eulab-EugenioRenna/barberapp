# Step 7 — Sedi e settori

Implementazione ALORA locale del 6 novembre 2026. [Piano esecutivo](locations-sectors-step-7-plan.md), [roadmap](evolution-roadmap.md) ed [evidenze verificabili](verification/locations-sectors-step-7.json). Le prove con identità sintetiche, il runtime locale e l’accettazione con account/provider reali sono distinte.

## Modello e conservazione

- `Location` appartiene all’azienda; `Sector` appartiene a una sola sede. Nomi, visibilità pubblica, attivazione, aperture e chiusure sono configurabili.
- Ogni servizio e risorsa appartiene a un settore. `CollaboratorSector` abilita un professionista a più settori e sedi. Anagrafiche clienti e catalogo prodotti rimangono aziendali; le operazioni nello storico del cliente rispettano gli ambiti autorizzati. Giacenze e movimenti appartengono allo Step 9.
- `Appointment` conserva sede e settore dell’operazione; `Sale` conserva la sede; ogni `SaleItem`, inclusi i prodotti, conserva il proprio settore. Un conto può comprendere più settori della stessa sede. Le righe di sedi diverse sono rifiutate.
- Spostare un servizio nel catalogo non riscrive appuntamenti e righe economiche esistenti. La modifica del conto mantiene gli ID e l’attribuzione delle righe conservate, anche con un solo settore selezionato. La chiusura di una prenotazione esistente usa la sede e il settore prenotati anche dopo uno spostamento del servizio nel listino. Il conto collegato impedisce spostamenti impliciti dell’appuntamento fra ambiti incompatibili.
- Rimuovere l’appartenenza di un professionista o spostare una risorsa richiede prima la riassegnazione delle prenotazioni future interessate. La disattivazione blocca le nuove prenotazioni e conserva la consultazione storica autorizzata.

La migrazione `20261106190000_locations_sectors` crea per ciascuna azienda una sede iniziale e il settore modificabile “Generale”. ID deterministici e `legacyKey=initial` identificano la corrispondenza di migrazione: non ricostruiscono un settore storico mai registrato. Il preflight rifiuta riferimenti operativi tra aziende incoerenti senza riassegnarli. Il backfill cambia soltanto i nuovi riferimenti. Non ricalcola importi, prezzi, imposte, orari, stati o relazioni preesistenti.

I tenant creati successivamente ricevono la stessa struttura iniziale tramite trigger. Una scrittura legacy senza ambito è compatibile quando la scelta è univoca; con più sedi/settori viene rifiutata la scelta ambigua. La riapplicazione passa dalla cronologia Prisma: il backfill dei permessi iniziali non resta una funzione richiamabile che possa ripristinare accessi revocati.

## Autorizzazioni e cache

Le funzioni Connect e le restrizioni ALORA restano obbligatorie. Un’appartenenza operativa non concede funzioni, licenze, password o ruoli Connect.

- Il titolare accede agli ambiti della propria azienda, entro le funzioni concesse.
- Manager e reception accedono ai settori assegnati in `UserSectorAccess`. La pagina Sedi consente di configurarne la visibilità soltanto con `locations.manage`, `team.manage` e la consultazione della squadra necessaria per leggere i profili.
- Il collaboratore accede alle appartenenze del professionista associato al suo ID locale, mantenendo il vincolo della propria agenda e delle proprie funzioni. Non viene associato cercando una coincidenza di email.
- `X-Alora-Location` e `X-Alora-Sector` restringono il contesto selezionato. Il backend ricava gli ambiti dall’azienda e dall’utente autenticati, verifica gli ID degli oggetti e applica predicati alle query; un header non concede accesso.
- Un conto contenente settori non autorizzati non espone righe o totale attraverso le viste dei conti. Il totale delle righe attribuite è disponibile separatamente, senza mostrare le altre righe del conto.

Le cache dei read model ricevono un suffisso derivato dagli ambiti autorizzati e selezionati nella singola richiesta. Le invalidazioni per prefisso continuano a coprire tutte le varianti. Una revoca produce un ambito e una chiave diversi. Lo stream dei conti da chiudere rivaluta sessione e settore a ogni aggiornamento; anche i destinatari di notifiche in attesa vengono ricontrollati sugli ambiti locali prima di chiamare un provider.

Il catalogo diventa **versione 5, 27 funzioni**: `locations.read` e `locations.manage` sono nuove capacità senza concessione legacy. Pubblicare la matrice non le assegna automaticamente. Nessun ruolo, indirizzo o password Connect è stato modificato per abilitare questa fase; il collaudo di quelle concessioni reali resta rinviato con gli altri controlli account richiesti dall’utente.

## Operatività e interfacce

La pagina `/admin/#/locations` configura sedi e settori, risorse e loro attivazione/visibilità, aperture settimanali, giorni di chiusura, appartenenze dei professionisti e visibilità operativa della squadra. Il selettore della sede/settore compare nel gestionale e nell’agenda personale; i form del listino e di creazione rapida richiedono un settore quando necessario. La vendita rapida conserva la sede del conto e richiede il settore per un prodotto altrimenti ambiguo.

Il booking pubblico mostra la sede prima della data e filtra servizi, settori e professionisti visibili. La disponibilità interseca aperture di sede e settore, chiusure aziendali e calendario personale nel fuso del tenant. Nel nuovo contratto delle aperture `weekday=0` significa domenica; il calendario professionale legacy mantiene la sua convenzione lunedì=0.

Le risposte pubbliche espongono soltanto i campi necessari alla prenotazione. La conferma ripete i nomi inseriti nella richiesta e non restituisce note, importi storici o contatti del cliente eventualmente riconosciuto nel CRM. Le descrizioni interne dei servizi restano escluse; la versione delle chiavi cache pubbliche evita di riutilizzare i precedenti payload.

Le risorse vengono riservate anche per servizi senza professionista. La capacità esistente della risorsa e i buffer entrano nei controlli. I conflitti del professionista considerano tutta l’azienda, anche quando le prenotazioni sono in sedi diverse. Un vincolo serializzato nel database impedisce che due scritture concorrenti superino contemporaneamente il controllo; il conflitto restituisce 409 senza dettagli SQL o dati privati. Non viene ripetuta automaticamente una scrittura fallita.

## Importi e confini successivi

`GET /locations/totals` somma una sola volta `SaleItem.lineTotal + taxTotal` per settore, sulle righe di conti `paid` o `partial` accessibili. Restituisce decimali a due cifre e una base di calcolo esplicita. Sono valori registrati delle righe: lo stato `partial` non documenta quanto sia già stato materialmente incassato. La quadratura esatta `0,10 + 0,20 = 0,30`, per due settori della stessa sede, è provata senza join sulle appartenenze dei professionisti.

I riepiloghi esistenti dei conti conservano la loro base: conti interamente accessibili che comprendono l’ambito scelto. Una nota nella dashboard distingue questo dato dal totale delle sole righe del settore, esposto nel selettore. Non costituiscono ancora i report completi azienda/sede/settore dello Step 13.

Nessun ordine parallelo è stato introdotto. La convergenza completa di conto e agenda rimane nello Step 8; listini settoriali avanzati, storico prezzi/IVA e magazzino nello Step 9; report completi e collaudo tablet nello Step 13. Il ripristino multisede verificato in questa fase usa il dump PostgreSQL, non l’importatore tabellare/JSON storico.

## Verifiche e ripristino

- Suite Jest, lint e build dei tre applicativi: risultati numerici nell’[evidenza](verification/locations-sectors-step-7.json).
- `node scripts/verify-locations-migration.mjs --baseline-dump .local/step7/before-runtime-deploy.dump`: restore del checkpoint precedente alla migrazione su copie nuove, deploy e riapplicazione Prisma, confronto di tutti i campi originali su 14 tabelle, zero operazioni senza attribuzione, preflight negativo e quadratura monetaria. Senza argomenti crea un dump del database locale corrente: se già migrato verifica anche il ripristino dei metadati degli ambiti, registrando il preflight come non rieseguito. Le copie create dallo script vengono eliminate; il database sorgente non viene modificato.
- `node scripts/verify-locations-http.mjs --browser`: database vuoto isolato con tutte le migrazioni, API effettive e sole sessioni sintetiche. Verifica isolamento, cache, header contraffatti, contesa fra booking, risorse, chiusure, riassegnazioni controllate, vendita rapida, modifica storica e disattivazione. I provider delle notifiche sono sostituiti e non inviano messaggi.
- `scripts/verify-locations-browser.cjs`: pagina reale compilata su API/DB isolati; creazione/configurazione, visibilità del manager, assegnazione multisettore, desktop, mobile 390 px e selettori pubblici. Richiede Playwright disponibile nel progetto o il percorso del package di test in `ALORA_PLAYWRIGHT_PACKAGE_JSON`.
- Client Prisma della versione precedente: lettura e scrittura verificate sulla copia migrata con una sola sede, senza nuovi campi nei payload.

Backup, log, screenshot e archivi dei runtime precedenti restano in `.local/step7/`, esclusa da Git. Per il runtime precedente è stato necessario esportare il filesystem dei container ancora attivi e importarlo in immagini locali senza le variabili d’ambiente applicative, poiché il vecchio riferimento Docker non era più disponibile. PostgreSQL, Redis, Connect e volumi condivisi sono preservati.

La compatibilità additiva non autorizza il ritorno alle vecchie query prive di filtri dopo l’attivazione multisede: in quel caso occorre una correzione in avanti oppure un ripristino pianificato che consideri le operazioni successive al backup. Non è stato eseguito un restore sul database operativo. Nessun rilascio di produzione o collaudo account/provider reale viene dichiarato da queste prove.
