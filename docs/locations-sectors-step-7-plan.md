# Step 7 — Sedi e settori: analisi e piano esecutivo

Analisi preparata il 6 novembre 2026. Gli step 5 e 6 hanno una [chiusura tecnica documentata](chiusura-step-5-6.md), con verifiche account rinviate su richiesta dell’utente. Al momento di questa analisi il dominio non era implementato. Implementazione e verifiche successive sono descritte nel [verbale Step 7](locations-sectors-step-7.md).

## Stato attuale verificato

`prisma/schema.prisma` contiene `Tenant`, `Service`, `Collaborator`, `Room`, `Appointment`, `Sale`, `SaleItem`, prodotti e orari. Non esistono sede, settore o appartenenze operative corrispondenti. I CRUD e le cache leggono per `tenantId`; disponibilità, booking pubblico e righe economiche non hanno questi ambiti. Il piano originario distingue esplicitamente:

- Settore appartenente a una sede e denominazione libera.
- Professionista abilitabile a più sedi e settori.
- Clienti e catalogo prodotti aziendali; giacenze e movimenti per sede nello Step 9.
- Conto appartenente a una sede e attribuzione del settore per ogni riga servizio.

Una sola tabella “Settore” con un filtro frontend non soddisfa questi requisiti e non risolve l’attribuzione storica delle operazioni.

## Sequenza di implementazione

1. **Modello additivo e migrazione controllata.** Introdurre sedi e settori con `tenantId`, stato attivo e denominazioni modificabili; un settore appartiene a una sola sede. Creare una sede e un settore iniziali per ogni azienda esistente, con corrispondenze ripetibili. Conservare tutti gli ID, appuntamenti, conti, importi e relazioni preesistenti.
2. **Appartenenze e integrità.** Associare servizi e risorse al settore; professionisti alle sedi e ai settori con appartenenze esplicite. Verificare nel database e nel servizio che azienda, sede e settore coincidano. Non attribuire dati usando soltanto un ID ricevuto dal browser.
3. **Attribuzione delle operazioni.** Aggiungere la sede al conto e all’appuntamento, il settore alle righe servizio e i riferimenti necessari ai servizi prenotati legacy. Il backfill usa la corrispondenza iniziale, senza inventare settori storici non registrati. Aggiornare tutti i percorsi di creazione, inclusi vendita diretta, Quick Order, booking pubblico e appuntamenti interni: la migrazione non basta a garantire le scritture successive.
4. **Contesto e autorizzazioni.** Scegliere la sede nella UI e derivare in backend l’intersezione tra permessi Connect, policy ALORA e appartenenze. Un permesso aziendale non diventa automaticamente permesso su tutte le sedi per un collaboratore. Catalogo versionato e nuove capacità esplicite dove necessarie; nessun grant automatico dopo la sincronizzazione.
5. **Disponibilità e operatività.** Incrociare orari, chiusure, assegnazioni e risorse con la sede/settore selezionati; impedire sovrapposizioni di un professionista abilitato in più sedi. Disattivare una sede o un settore impedisce nuove prenotazioni, conservando la consultazione storica autorizzata.
6. **Configurazione e filtri.** CRUD sedi/settori, attivazione, assegnazioni e selector nella gestione servizi, squadra, risorse e agenda. I filtri entrano nelle query e nelle chiavi cache. Prezzi e durata rimangono quelli del contratto esistente finché non viene definita la configurazione settoriale: non duplicare arbitrariamente i servizi per rappresentare una differenza di prezzo.
7. **Riconciliazione e collaudo.** Prova della migrazione su copia del database, riapplicazione, restore del backup e confronto di record/ID/relazioni/importi. Due aziende, più sedi e settori con nomi liberamente scelti; tentativi incrociati, professionisti multisede, riattribuzione controllata, disattivazione e booking concorrenti. I totali devono riconciliarsi con il totale aziendale senza moltiplicare le righe tramite join sulle appartenenze.

## Confini con gli step successivi

Lo Step 8 deve far evolvere `Sale` e `SaleItem` nel conto operativo unico: lo Step 7 ne prepara l’attribuzione, evitando un ordine parallelo. Il calcolo monetario, lo storico prezzi, IVA e giacenze multisede spettano allo Step 9, ma la loro attribuzione deve essere preservata fin d’ora. I report settoriali completi dello Step 13 richiederanno le medesime righe autorevoli e non ricalcoli basati sul settore corrente dell’anagrafica.

## Gate di rilascio

Analisi/applicazione/verifica ripetibili; nessuna operazione esistente non attribuita; query e cache isolate; backup leggibile e restore dimostrato; endpoint/UI/browser verificati separatamente; contratti di lettura/scrittura precedenti compatibili sulle colonne additive in configurazione univoca; rollback non applicabile alle vecchie query senza filtri dopo l’attivazione multisede. L’accettazione operativa dello Step 6 e l’autorizzazione di fase prevista dal piano restano distinte dalla preparazione di questo documento.
