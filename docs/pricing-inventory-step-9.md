# Step 9 — Prezzi, IVA e magazzino

Implementato e verificato nel Docker locale il 7 novembre 2026. [Piano esecutivo](pricing-inventory-step-9-plan.md), [evidenze](verification/pricing-inventory-step-9.json), [roadmap](evolution-roadmap.md). Account Connect e invii a provider reali restano esclusi.

## Prezzi e calcolo autorevole

Il motore `pricing/money.ts` calcola con decimali, senza aritmetica floating point sugli importi. La modalità del prezzo è esplicita: `net` (IVA esclusa), `gross` (IVA inclusa), oppure `legacy` per i valori di cui non è documentata la semantica IVA. Il prezzo unitario viene normalizzato al centesimo; imponibile, imposta e sconto sono arrotondati per riga con half-up. I totali del conto sommano le righe, senza un secondo ricalcolo dal catalogo.

Ogni riga conserva prezzo inserito, modalità, aliquota applicata, imponibile prima dello sconto, sconto netto, imposta e importo finale. Lo sconto complessivo è un importo sul totale finale: viene ripartito proporzionalmente, con i centesimi residui assegnati deterministicamente nell'ordine delle righe della richiesta. Il prezzo unitario originale non viene sovrascritto dalla ripartizione. Per righe legacy con imposta registrata ma aliquota sconosciuta occorre prima scegliere esplicitamente la modalità IVA; non viene ricavata un'aliquota dal passato.

`POST /sales/quote` usa lo stesso normalizzatore del salvataggio, con le stesse restrizioni di tenant e conto. La cassa attende l'anteprima del server e scarta le risposte superate. L'anteprima non scrive vendite, prezzi, magazzino o audit di scrittura. Variazioni di prezzo nelle righe con IVA definita, cambi di modalità o aliquota richiedono una motivazione. I valori già applicati vengono usati quando il listino cambia, anche se un riferimento al catalogo è stato eliminato in passato.

Il booking pubblico mostra il lordo quando la modalità IVA è definita. Il conto aperto conserva quel totale e la relativa scomposizione; agenda e cassa mantengono gli stessi ID. Il valore legacy resta distinguibile: una modalità non documentata non equivale a un'aliquota zero o a un'esenzione.

## Storico e attribuzione

`CatalogPriceHistory` conserva le variazioni di listino e le configurazioni di costo, con autore, motivazione e momento registrato. `OrderPriceRevision` conserva separatamente gli snapshot precedenti e successivi dei prezzi applicati al conto. Entrambi i registri sono immutabili. Le fotografie iniziali hanno origine `migration_observation`, senza autore o data storica inventati. Gli eventi successivi distinguono applicazione, booking pubblico e osservazioni nel database.

Le aliquote di acquisto e vendita sono indipendenti. Il catalogo ha campi distinti per modalità e aliquota del costo; ogni carico registra la propria aliquota di acquisto, che non viene ereditata dalla vendita. Il costo medio della giacenza deriva dai movimenti netti, non dal prezzo corrente del catalogo.

Listino e cassa espongono gli storici con paginazione. Le letture di un conto e delle sue revisioni richiedono accesso all'intero conto autorizzato. Il catalogo prodotti rimane aziendale e non restituisce le righe economiche delle vendite. Prodotti e servizi vengono disattivati, conservando riferimenti e storici; possono essere riattivati esplicitamente dal listino.

## Giacenze e registro

`StockBalance` appartiene a prodotto e sede. Nessuna quantità storica viene ricostruita: finché non si registra un inventario iniziale la giacenza è mostrata come sconosciuta. Per quantità iniziali positive serve un costo netto esplicito; l'apertura non inventa un acquisto o un'IVA passati. Il tracciamento viene abilitato esplicitamente. Dopo l'apertura non può essere disabilitato cancellando la continuità del registro; si può disattivare il prodotto conservandone la storia.

`InventoryOperation` conserva chiave idempotente, impronta del comando, autore, motivo e risultato originale. Ripetere lo stesso comando restituisce lo stesso risultato; riutilizzare la chiave con dati diversi restituisce conflitto. La UI conserva il comando dopo un esito non disponibile e consente di ripeterlo con la stessa chiave. Per modificarlo occorre controllare il registro e iniziare una nuova operazione.

`StockMovement` è append-only. Sono disponibili apertura, carico, scarico, rettifica per quantità contata, trasferimento e reso. I movimenti e i consumi fisici supportano tre decimali; i valori e i costi di scarico ne conservano sei. La quantità delle righe di vendita mantiene il contratto intero esistente. Ogni scarico usa il costo medio ponderato osservato nella transazione; l'ultimo scarico svuota esattamente anche l'eventuale residuo di valorizzazione.

Il trasferimento richiede entrambe le sedi autorizzate e un'apertura già registrata nella destinazione. Quantità e valore escono da una sede ed entrano nell'altra nella stessa transazione. Un reso si collega allo scarico originale, ne conserva il costo e non può superarne la parte ancora restituibile. Le rettifiche di un conto reintegrano gli scarichi ancora aperti, dal più recente, con riferimenti e costi originali: una quantità già reintegrata non può essere resa una seconda volta. Un cambio di stato del pagamento non viene interpretato come reso fisico.

Comandi di magazzino, prenotazioni e checkout usano lo stesso blocco transazionale per azienda. Il database impedisce saldi negativi, riferimenti tra aziende, modifiche dei registri e differenze fra somma dei movimenti e saldo. Un errore annulla l'intera operazione, inclusi conto, righe, stato dell'appuntamento e movimenti già preparati nella transazione.

## Conferma del conto e continuità

La conferma del conto registra i prodotti tracciati e i consumi fisici dichiarati in `ServiceProduct.consumptionUnits`. Le associazioni commerciali `optional`, `recommended`, `included` e `required` non diventano automaticamente consumo. La configurazione fisica viene congelata alla prima registrazione della riga; le modifiche successive al catalogo non generano scarichi retroattivi. Le revisioni del conto registrano soltanto le differenze dovute alle quantità o alle righe modificate.

Le righe delle operazioni già registrate o storicamente ambigue restano `legacy`, senza movimenti inventati. Soltanto il lavoro chiaramente futuro, prenotato e con conto ancora aperto, diventa `pending` alla migrazione, per la prima registrazione effettiva. Le correzioni di quantità legacy non ricostruiscono uno scarico passato: richiedono una riconciliazione fisica esplicita. Le nuove righe aggiunte dopo l'attivazione seguono il registro.

La coda dei conti da chiudere è adattata al modello unico: considera il conto aperto della prenotazione, non soltanto l'assenza di una vendita. Il collaudo dello stream reale delle API verifica la comparsa del conto aperto e la sua rimozione alla registrazione.

## Accessi e interfaccia

Il catalogo diventa **versione 6, 29 funzioni**, con `inventory.read` e `inventory.manage` senza concessione legacy. La nuova matrice non assegna ruoli o licenze Connect. Configurare tracciamento o consumi richiede anche `inventory.manage`; la vendita autorizzata registra automaticamente i movimenti già configurati senza concedere amministrazione del magazzino al cassiere.

La pagina `/admin/#/inventory` gestisce giacenze, inventario iniziale, carichi, rettifiche, resi e trasferimenti, con quantità e valore dopo ogni movimento. La giacenza è dell'intera sede; il registro rispetta anche i settori autorizzati e selezionati. I resi conservano il settore dello scarico originale. Header e ID forniti dal client restringono il contesto e non concedono accesso ad altre sedi o settori.

I form del listino distinguono prezzo e costo, IVA acquisto/vendita, tracciamento e consumi; la cassa distingue modalità, aliquota, sconto e motivazione. Desktop e mobile 390 px sono verificati con Playwright su API e database isolati. Il collaudo tablet completo resta nello Step 13.

## Verifiche, ripristino e confini

Gli script `verify-pricing-inventory-migration.mjs`, `verify-pricing-inventory-http.mjs` e `verify-pricing-inventory-browser.cjs` producono evidenze private in `.local/step9/`. La migrazione viene applicata e riapplicata su copie ripristinate del checkpoint: confronto di tutti i campi originali, ID, conteggi e valori su 15 tabelle; nessuna giacenza iniziale o IVA dedotta; storici osservati senza duplicati. Le fixture verificano anche le prenotazioni future ancora aperte, i vincoli negativi e l'immutabilità.

Le API dei collaudi usano controller, guard, audit, cache service e PostgreSQL reali; identità e provider sono sintetici, mentre Redis è sostituito da un adattatore in memoria. Nessun invio viene effettuato. Sono ripetuti anche i collaudi di sedi/settori e conto unico. Numeri, timestamp, immagini e limiti sono nell'[evidenza](verification/pricing-inventory-step-9.json).

Backup leggibile e immagini del runtime precedente sono conservati; per i riferimenti Docker non più disponibili è stato usato export/import del filesystem in streaming, senza le variabili applicative. Il restore è verificato sulle copie, senza ripristinare il database operativo. Dopo l'attivazione del tracciamento le vecchie scritture non coordinano il registro: occorre una correzione in avanti oppure un restore pianificato, con riconciliazione delle operazioni successive al checkpoint.

Gli incassi puntuali, acconti, saldi, misti e storni restano nello Step 10. Le quantità movimentate e i prezzi registrati non provano un incasso esterno o un adempimento fiscale. Report completi di margine, IVA, cassa e aggregazione aziendale sono nello Step 13; produzione e provider reali mantengono la propria accettazione separata.
