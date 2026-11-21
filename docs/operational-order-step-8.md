# Step 8 — Conto operativo unico

Implementazione locale del 7 novembre 2026, secondo il [piano esecutivo](operational-order-step-8-plan.md). Le [evidenze](verification/operational-order-step-8.json) distinguono migrazione su copie, API con sessioni sintetiche, browser e runtime locale. Account Connect e provider reali restano esclusi come richiesto dall'utente.

## Contratto operativo

`Sale` e `SaleItem` costituiscono conto e righe autorevoli. `Appointment.orderItemId` collega in modo univoco la rappresentazione di agenda alla riga del servizio; `Sale.appointmentId` conserva il collegamento legacy alla prenotazione principale. Le vendite autonome di prodotti restano prive di occupazione dell'agenda.

Il servizio comune `OperationalOrderService`, usato dagli adattatori agenda, booking pubblico e cassa, coordina le transazioni con lo stesso blocco per tenant dei controlli sulle risorse. Il booking crea appuntamento, conto aperto non pagato e riga nella stessa transazione. Un errore nell'apertura del conto annulla anche l'appuntamento. Il professionista pianificato resta in agenda; la riga conserva separatamente l'esecutore effettivo e non lo inventa al momento della prenotazione.

Le modifiche economiche del booking aggiornano la riga collegata. La cassa recupera il conto con `GET /sales/for-appointment/:id`, riservato a `sales.manage` e agli ambiti operativi autorizzati. “Salva conto aperto” conserva stato non pagato; “Registra vendita” conferma lo stesso conto e mantiene gli ID delle righe prenotate. Le richieste legacy di creazione vendita con `appointmentId` sono adattate allo stesso percorso di aggiornamento. Una seconda creazione su un conto già registrato restituisce conflitto.

`orderStatus` (`open`, `confirmed`, `superseded`), stato della prenotazione e `paymentStatus` sono distinti. Un conto aperto non può essere pagato né conservare un metodo di pagamento. Le revisioni consentono alla UI di rifiutare un salvataggio basato su dati superati. L'assenza di una revisione nel vecchio payload usa quella letta all'inizio della richiesta; non offre la stessa protezione contro un client che riapre dati obsoleti e omette la revisione.

Il checkout conserva servizio, settore e identità della riga prenotata; per cambiare il servizio si usa l'agenda, con i relativi controlli sulle risorse. Le correzioni economiche di un conto confermato passano dalla cassa. Il prezzo finale proiettato sull'appuntamento è quello della propria riga, non il totale di prodotti e altri servizi. L'eliminazione di un conto collegato è rifiutata per conservare il legame storico.

## Migrazione e riconciliazione

La migrazione additiva `20261107100000_operational_order` non modifica i campi originali di appuntamenti, vendite o righe economiche.

- Gli appuntamenti senza vendita ricevono un conto `open/unpaid`, origine `legacy_appointment`, e una riga con ID deterministici. Il valore viene dal prezzo finale o stimato registrato; l'assenza di entrambi resta zero nella nuova riga, senza inventare un incasso.
- Una vendita collegata con una sola riga compatibile per servizio, cliente, sede e settore viene collegata a quella riga esistente. Gli importi e gli ID restano invariati.
- Più vendite collegate, più righe candidate o una riga mancante producono `orderIssue`. Nessuna riga viene selezionata automaticamente, eliminata, fusa o ricalcolata.
- I conti aperti di migrazione conservano il fallback economico storico degli appuntamenti completati senza vendita. I conti aperti non compaiono come vendite registrate. Il fallback termina alla conferma esplicita del conto.

`node scripts/reconcile-operational-orders.mjs` produce un'analisi in sola lettura. Per applicare scelte già esaminate: `node scripts/reconcile-operational-orders.mjs --apply mapping.json`, con un array di `{ "appointmentId": "…", "saleItemId": "…" }`. Lo strumento verifica la compatibilità, applica l'intero lotto in transazione ed è ripetibile. Non cambia importi o riferimenti originali: le altre vendite storiche restano registrate, senza una deduzione automatica su quali siano economicamente errate. Un collegamento senza una riga compatibile richiede prima la correzione esplicita del dato operativo. L'applicazione operativa deve essere in manutenzione durante una riconciliazione CLI, con invalidazione delle cache o riavvio prima della riapertura.

Il collegamento di una vendita autonoma a un booking può sostituire soltanto un conto aperto non modificato con una sola riga, e richiede una sola riga compatibile nella vendita. Il conto provvisorio viene conservato come `superseded`, senza duplicare la riga autorevole. Collegamenti incompatibili o conti già modificati restituiscono conflitto.

## Prove e ripristino

`scripts/verify-operational-order-migration.mjs` ripristina il dump su copie nuove, aggiunge fixture storiche isolate, applica e riapplica Prisma, confronta tutti i campi originali su 14 tabelle e riconcilia il totale storico. Prova inoltre vincoli differiti, duplicati, scelte esplicite, rollback di un lotto errato e ripetibilità. Dopo il rilascio locale può essere ripetuto con `--baseline-dump .local/step8/before-runtime-deploy.dump`.

I collaudi HTTP e browser usano l'API compilata e PostgreSQL reale su un database temporaneo vuoto. Solo identità e provider esterni sono sostituiti. Le prove comprendono isolamento, rollback di un booking fallito, identità stabile delle righe, modifica in agenda, salvataggio aperto, revisione obsoleta, contesa al checkout, conservazione dello storico e interfaccia desktop/mobile. Nessun messaggio viene inviato.

Backup e immagini precedenti rimangono in `.local/step8/` e nei tag Docker indicati nell'evidenza. Il restore è provato sulle copie; nessun ripristino del database operativo è stato eseguito. Tornare al vecchio applicativo dopo nuove operazioni richiede una procedura pianificata: i nuovi conti aperti devono restare riconoscibili e le vecchie scritture non coordinano il nuovo collegamento.

## Dipendenze ancora aperte

Il registro puntuale di acconti, saldi, pagamenti misti e storni appartiene allo Step 10: `paymentStatus=paid` rimane il contratto gestionale legacy, non prova un pagamento eseguito da un provider. La pianificazione completa di servizi multipli sulle singole righe viene estesa nella stessa fase. Calcolo monetario centralizzato, IVA, prezzi storici e stock sono lo Step 9; i report completi lo Step 13. Queste funzionalità non sono dichiarate concluse dallo Step 8.
