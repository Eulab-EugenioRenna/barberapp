# Step 8 — Conto operativo unico: piano esecutivo

Avviato il 7 novembre 2026 su richiesta «procedi con il resto». L'autorizzazione comprende la prosecuzione degli step della roadmap; resta escluso il lavoro sugli account Connect. Il codice corrente e le evidenze di ogni dominio determinano la chiusura, separata da provider e produzione.

## Diagnosi sul codice corrente

`Appointment` contiene un solo servizio; `Sale.appointmentId` collega facoltativamente la vendita. Il checkout normalizza nuove righe, crea una vendita e scrive il totale sull'appuntamento. Le modifiche in agenda e cassa hanno percorsi distinti. La dashboard conserva il fallback degli appuntamenti completati senza vendita; inventare vendite pagate durante la migrazione cambierebbe il significato dei dati.

## Contratto scelto

- Evolvere `Sale`/`SaleItem`, conservando tabelle e ID. `Appointment.orderItemId` collega in modo univoco la rappresentazione di agenda alla riga autorevole. Il vecchio `Sale.appointmentId` resta l'adattatore della prenotazione principale.
- Separare `Sale.orderStatus` (aperto/confermato) da `paymentStatus` e dallo stato dell'appuntamento. I nuovi booking aprono un conto non pagato nella stessa transazione. L'esecutore della riga rimane distinto dal professionista pianificato in agenda.
- Un servizio applicativo comune coordina booking e checkout. Il checkout di un booking aggiorna conto e righe esistenti; non crea una seconda vendita. Le righe collegate conservano gli ID, anche quando il payload legacy non li contiene. Revisioni e blocco transazionale impediscono sovrascritture concorrenti.
- Migrazione additiva: vendite autonome conservate; collegamenti univoci coerenti acquisiti; appuntamenti senza vendita ricevono conto aperto e riga deterministici, senza inventare incassi. Più vendite o righe candidate, clienti/sedi incoerenti o servizi mancanti vengono segnalati in `orderIssue`, senza selezione automatica.
- Il fallback economico storico rimane identificabile e invariato fino a conferma esplicita del conto. La cassa non conta i nuovi conti aperti come vendite registrate.
- Le scritture su una riga prenotata mantengono servizio, settore e sede coerenti; un conto collegato non viene eliminato per perdere il legame storico.

## Prove richieste

1. Dump leggibile e restore su copia; confronto dei campi originali, ID e totali; doppia applicazione senza duplicati.
2. Fixture con appuntamenti senza vendita, vendite autonome, collegamenti corretti, duplicati e riferimenti ambigui; nessuna variazione dei valori storici.
3. API reali con identità sintetiche: creazione booking e conto atomica, modifica agenda/riga, checkout sullo stesso ID, conflitti e isolamento tra tenant/settori.
4. Browser: apertura del conto dall'agenda, modifica, conferma senza righe duplicate; interfacce esistenti compatibili.
5. Suite, lint, build, Docker locale e confronto finale; verbale con limiti e prossime dipendenze. Nessun collaudo account o provider reale incluso.

I servizi multipli con agenda completa e i movimenti di pagamento appartengono allo Step 10; calcolo monetario centralizzato, IVA, prezzi storici e stock allo Step 9. Il collegamento riga/agenda introdotto qui ne costituisce la base.
