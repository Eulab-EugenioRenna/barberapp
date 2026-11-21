# Step 10 — Prenotazione multipla e incasso sul conto unico

Avviato dopo la chiusura tecnica locale dello [Step 9](pricing-inventory-step-9.md), nell'autorizzazione «procedi con il resto». L'obiettivo complessivo comprende ancora gli step 10–14. Account Connect esclusi; provider, produzione e prove riservate all'utente restano distinti dai collaudi sintetici.

## Codice iniziale verificato

- `Sale`/`SaleItem` sono il conto autorevole. `Appointment.orderItemId` collega una rappresentazione di agenda a una riga; `Sale.appointmentId` conserva il collegamento principale legacy. Gli altri servizi di un conto non hanno ancora una pianificazione completa per riga.
- Le prenotazioni interne e pubbliche accettano un servizio. Il pubblico richiede ancora un professionista esplicito quando il servizio lo richiede. Disponibilità, orari, appartenenze, buffer e capacità sono già presenti; i conflitti effettivi sono serializzati nel database per azienda.
- `paymentStatus` e `paymentMethod` sono ancora il contratto gestionale legacy. Non esistono movimenti individuali di acconto, saldo o rimborso. Uno stato `partial` non documenta l'importo incassato.
- Il modulo `payments` espone soltanto impostazioni disabilitate e risposte 501 per la preparazione di un pagamento esterno. Non è un provider operativo e non deve essere presentato come una transazione bancaria eseguita.
- Prezzi, IVA, sconti, storico delle variazioni e stock sono già coordinati con la conferma del conto. Una variazione dello stato del pagamento non produce un reso fisico.

L'avanzamento del registro incassi e i contratti correnti sono nel [resoconto di lavoro](booking-payments-step-10.md). La diagnosi qui sopra documenta il punto di partenza, non sostituisce lo stato attuale.

## Operazione prenotabile

Evolvere lo stesso servizio applicativo del conto, senza un secondo ordine. Ogni servizio pianificato ha una riga stabile e il proprio `Appointment`, con sede/settore, durata, risorsa e professionista pianificato. Il collegamento legacy principale rimane un adattatore. Cliente e sede sono comuni al conto; i settori possono essere diversi nella stessa sede.

La creazione multipla deve essere atomica e idempotente. Validare tutti i riferimenti, risolvere il cliente e riservare le risorse nello stesso confine transazionale. Un risultato non disponibile si riconcilia con la stessa chiave, senza creare clienti, conti o prenotazioni duplicati. Un replay richiede ancora le autorizzazioni correnti.

Il cliente può scegliere un professionista oppure “Nessuna preferenza”. In entrambi i casi le risorse effettive vengono riservate internamente. La disponibilità dell'intera sequenza deve considerare anche le assegnazioni già proposte nelle altre righe, i buffer, gli orari e le capacità. Il salvataggio ricontrolla il piano nella transazione: non basta che uno slot fosse disponibile durante la ricerca. Le modifiche non devono spostare silenziosamente il cliente a un altro orario.

Agenda e cassa devono aprire lo stesso conto: servizi aggiunti, prodotti, prezzi concordati ed esecutori rimangono sulle righe autorevoli. Le modifiche di calendario usano le regole di disponibilità, quelle economiche il motore dello Step 9. L'esecutore effettivo resta distinto dal professionista pianificato.

## Registro degli incassi

Introdurre un registro immutabile di movimenti gestionali, con importo decimale, metodo, tipo, autore, data registrata, motivazione quando richiesta e riferimento all'operazione originale. La registrazione di un pagamento misto contiene più movimenti nella stessa transazione. Nessun movimento significa automaticamente addebito o rimborso eseguito da un provider: la UI registra quanto dichiarato dall'operatore, mantenendo disabilitati i provider non integrati.

Separare almeno:

- valore registrato delle righe;
- incasso conosciuto e rimborsi registrati;
- residuo;
- stato di pianificazione/esecuzione;
- stato economico derivato dal registro.

Il conto può ricevere un acconto prima della prestazione, poi uno o più saldi. Chiavi idempotenti, impronte e revisione attesa impediscono doppie registrazioni e sovrappagamenti concorrenti. Il rimborso richiede un movimento originale e non può superarne l'importo ancora rimborsabile. Un rimborso monetario non dichiara un reso di merce.

Per conti già incassati, una modifica del totale non deve creare implicitamente denaro, cancellare pagamenti o lasciare un saldo incoerente. Riduzioni sotto il netto già incassato richiedono un rimborso esplicito o una correzione coordinata. L'annullamento conserva righe e movimenti; libera le prenotazioni future secondo le transizioni consentite. Le restituzioni fisiche restano esplicite e collegate al registro di magazzino.

## Storico e migrazione

La migrazione conserva ID, relazioni, prezzi, totali, stati e metodi originari. Non ricava un acconto da `partial`, né una transazione bancaria da `paid`. I conti preesistenti privi di registro conservano una base storica riconoscibile e un incasso sconosciuto, finché un operatore non registra una riconciliazione esplicita con motivazione e autore.

Un saldo iniziale dichiarato dall'operatore serve a riconciliare il conto, senza attribuirgli automaticamente una data di incasso passata o registrarlo come denaro riscosso oggi. Le nuove registrazioni mantengono la propria provenienza. Le scritture legacy diventano adattatori allo stesso comando applicativo; una dichiarazione parziale senza importo o un metodo misto senza ripartizione non può inventare movimenti.

## Prove richieste

1. Restore del checkpoint Step 9, migrazione e riapplicazione: tutti i campi originali e i valori storici invariati; nessun pagamento o stock inventato.
2. Prenotazioni con più servizi e settori della stessa sede, preferenza e assegnazione automatica; conflitti tra righe, professionisti condivisi, risorse, buffer, chiusure, riassegnazioni e annullamenti.
3. Riprogrammazione e modifica del conto conservando gli ID delle righe; un errore annulla tutte le modifiche collegate.
4. Acconto più saldo, pagamenti misti, replay, chiavi riutilizzate con dati diversi, revisione superata, contesa e rimborso oltre il residuo rifiutati.
5. Quadratura fra righe, incassi, rimborsi e residuo, con dati legacy sconosciuti separati e nessuna duplicazione all'incasso.
6. Isolamento azienda/sede/settore anche su operazioni ripetute e storici; autorizzazioni del consumer ancora obbligatorie.
7. Browser interno e pubblico su API/PostgreSQL isolati, regressioni degli step 7–9, suite/lint/build, Docker locale e confronto finale. Nessun invio a destinatari reali o operazione finanziaria esterna compreso nei test sintetici.

Automazioni durevoli e messaggistica completa accompagnano gli step 11–12; report riconciliati e tutti i formati tablet lo Step 13. La chiusura dello Step 10 non può sostituire l'accettazione di questi domini.

## Esito tecnico locale dell’8 novembre 2026

Le prove richieste per lo Step 10 sono eseguite nei confini documentati nel [verbale](booking-payments-step-10.md). Sei migrazioni applicate al Docker principale, backup leggibile conservato e valori originari invariati su 42 tabelle e 471 colonne; tre immagini verificate e servizi sani. Riprogrammazione singola e modifica degli orari condividono pianificatore e lock transazionale. L’accettazione provider/produzione e gli step 11–14 rimangono separati.
