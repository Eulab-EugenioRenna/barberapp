# Step 9 — Prezzi, IVA e magazzino: piano esecutivo

Avviato il 7 novembre 2026 dopo la chiusura tecnica locale del [conto unico](operational-order-step-8.md), nell'autorizzazione «procedi con il resto». Account Connect esclusi; nessuna attivazione di produzione dichiarata.

## Diagnosi aggiornata

Il catalogo prodotti conserva `price`, `vatRate` e `cost`, ma le API di scrittura espongono soltanto il prezzo e non esiste un registro delle giacenze. Il prodotto è aziendale. `ServiceProduct` esprime associazioni commerciali (`optional`, `recommended`, `included`, `required`), che non dimostrano un consumo fisico. I calcoli delle righe passano ancora attraverso `number`; il totale IVA viene accettato dal payload. Non sono presenti giacenze per sede, movimenti, valorizzazione o storico prezzi. Non è possibile ricostruire giacenze o aliquote storiche mancanti.

## Contratto da implementare

1. Motore monetario unico lato server con decimali esatti, arrotondamento al centesimo per riga, ingresso netto/lordo esplicito, aliquota e prezzi applicati conservati nella riga. Lo sconto complessivo viene distribuito proporzionalmente, con residui al centesimo assegnati deterministicamente. L'interfaccia presenta un'anteprima; il backend conserva il calcolo autorevole.
2. Metadati di prezzo additivi su prodotti/servizi e righe; modalità `legacy` per dati senza semantica IVA documentata. Nessuna riga storica viene ricalcolata dalla migrazione. Aliquota di vendita indipendente da quella di acquisto. Override espliciti con motivazione. Storico dei cambi di listino con autore e momento osservato; una fotografia di migrazione non rappresenta un evento storico ricostruito.
3. Giacenze per prodotto/sede, attivazione esplicita del tracciamento, apertura/inventario controllati e quantità decimali. Dati iniziali sconosciuti non diventano implicitamente stock disponibile pari a zero. Catalogo e vecchie vendite non generano movimenti retroattivi.
4. Registro append-only: carico, scarico, rettifica, consumo, reso e trasferimento collegato tra sedi. Motivo e autore obbligatori dove applicabile, chiave idempotente e hash del comando; nessun retry che duplichi effetti. Stock non negativo, costo medio ponderato su valori netti e costo congelato allo scarico.
5. Conferma del conto: prodotti e consumi fisici esplicitamente configurati generano movimenti una volta nella stessa transazione. Le associazioni commerciali non diventano consumi per deduzione. Modifiche successive registrano differenze tracciate; un rimborso monetario non prova da solo un reso fisico.
6. Nuove funzioni `inventory.read/manage` con concessione esplicita, pagina magazzino e prezzi coerente con sede/settore selezionati. Filtri anche su API, letture, cache e trasferimenti: appartenenza a una sede non concede automaticamente accesso all'altra.

## Prove di chiusura

- Fixture monetarie indipendenti: netto/lordo, arrotondamenti, aliquote diverse, quantità, sconto complessivo e centesimi residui; somma righe = totale.
- Migrazione da checkpoint Step 8 su copie ripristinate: originali e totali invariati, riapplicazione, nessuna giacenza o imposta inventata.
- Quadratura stock/registro e valore/costo medio: carichi, consumo/vendita, rettifiche, resi e trasferimenti. Ripetizioni e concorrenza non raddoppiano gli effetti; errori annullano l'intera transazione.
- Isolamento azienda/sede/settore, override senza motivo rifiutati, storico listino immutabile e operazioni su prodotti disattivati gestite esplicitamente.
- Browser per configurazione e operazioni, suite/lint/build, Docker locale, riconciliazione e verbale con evidenze separate da provider/produzione.

Gli incassi puntuali e la pianificazione multipla sono lo Step 10; i report completi e l'accettazione tablet sono lo Step 13. Il motore qui introdotto prepara quei domini e non ne sostituisce i collaudi.

## Chiusura tecnica locale

Completati motore monetario e anteprima, snapshot e storici immutabili del listino e dei prezzi applicati, giacenze e registro per sede, chiavi idempotenti, conferma del conto e consumi espliciti, resi e trasferimenti, autorizzazioni e UI. La migrazione conserva i campi originali di 15 tabelle e non inventa stock o IVA. Le prove coprono anche il lavoro futuro ancora prenotato e la coda SSE dei conti aperti.

[Verbale completo](pricing-inventory-step-9.md) ed [evidenze](verification/pricing-inventory-step-9.json). Runtime locale aggiornato; provider e produzione mantengono l'accettazione separata. Il piano complessivo prosegue con lo Step 10.
