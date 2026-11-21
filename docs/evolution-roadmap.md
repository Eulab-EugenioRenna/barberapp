# ALORA by EULAB — Roadmap di esecuzione

Questa sequenza recepisce il piano approvato nella conversazione e aggiorna la sequenza preliminare di `evolve.md`: la sicurezza precede il rebranding. Un dominio alla volta; implementazione locale, prove isolate e accettazione di produzione sono evidenze distinte.

## Decisioni fissate

- SaaS condiviso: azienda ALORA = cliente Connect con installazione logica propria.
- Un solo pulsante di accesso, precedenza Connect. Nessun accesso operativo locale: la prova legacy permette solo di inviare una pratica di migrazione approvata da EULAB. Signup come richiesta; account solo Connect provisionato localmente dopo SSO verificato. Collegamenti espliciti per installazione/ID locale, senza unioni automatiche per email.
- Connect governa identità, sessioni, licenze e assegnazioni centrali; ALORA governa dati e restrizioni operative. Le estensioni Connect sono gestite dall’utente; questo lavoro modifica soltanto ALORA.
- Clienti comuni all’azienda; ogni sede ha indirizzo, settori, dashboard e magazzino. Catalogo prodotti aziendale, stock per sede; professionisti abilitabili a più sedi/settori.
- Prenotazione e conto rappresentano una sola operazione: evoluzione di `Sale`/`SaleItem`, agenda compatibile tramite `Appointment`, senza duplicazione delle righe al pagamento.
- Più servizi per prenotazione, professionista facoltativo con riserva interna delle risorse. Assegnazione pianificata ed esecutore effettivo distinti.
- Acconti, saldi, pagamenti misti e storni gestionali registrati individualmente. Integrazione fiscale successiva. Venduto, incassato e residuo riconciliati.
- Migrazioni additive con analisi/applicazione/verifica, checkpoint, confronto di ID/relazioni/importi e ripristino dimostrato. Nessuna reinterpretazione automatica dei dati storici mancanti.

## Requisito trasversale dell’integrazione Connect

La prossima applicazione deve poter integrare Connect istanziando il client SDK e richiamandone i metodi, con pochi adattatori ai propri dati. Consolidare nel modulo comune il protocollo e le sessioni oggi implementati nel BFF ALORA; lasciare all’app verifica legacy, provisioning e restrizioni operative. [Confine e criteri di accettazione](connect-sdk-integration-contract.md). Il requisito accompagna il piano e non interrompe i collaudi attuali; non dichiara queste API già disponibili nello SDK 0.9.0.

## Sequenza e prove di chiusura

| Step | Dominio | Stato / prova richiesta |
| --- | --- | --- |
| 0 | Baseline | Audit tecnico svolto; baseline e copia verificata della produzione ancora da acquisire |
| 1 | Sicurezza e legacy | [Implementato e verificato localmente](security-step-1.md); copia produzione, browser e rilascio pendenti |
| 2 | Rebranding ALORA | [Implementato e verificato localmente](rebranding-step-2.md); browser/PWA reale e rilascio pendenti |
| 3 | Catalogo delle funzioni | [Implementazione locale verificata](function-catalog-step-3.md), aggiornata dagli step successivi a 32 funzioni e matrice versione 7; handler API/UI censiti. Endpoint corrente verificato tramite Nginx; accettazione di produzione separata |
| 4 | SSO e attivazione azienda | SSO adottato con SDK npm 0.10.0, poi candidata locale 0.11.0 per Step 5 e Connect schema 014. Accesso dopo migrazione confermato dall’utente; login consumer e revoca di sessione aperta verificati sul Docker reale. [Evidenze e limiti](auth-flow-step-4.md); rinnovo/scadenze completi e accettazione di produzione ancora da verificare |
| 5 | Ruoli e squadra | [Chiuso tecnicamente](chiusura-step-5-6.md): Squadra unificata, ruoli/delega, creazione e ripresa, restrizioni locali, professionista associato e agenda personale. Creazione collaboratori e apertura agenda confermate dall’utente. Verifiche account rinviate su sua richiesta; accettazione di produzione separata |
| 6 | Sicurezza personale | [Chiuso tecnicamente per il consumer ALORA](chiusura-step-5-6.md): pagina personale, console SSO, stato sicurezza/sessioni/dispositivi/notifiche e revoche controllate. Verifiche account rinviate; MFA estesa e notifiche provider non attivate non dichiarate operative |
| 7 | Sedi e settori | [Implementato e verificato localmente](locations-sectors-step-7.md): migrazione additiva riconciliata, ambiti nelle query/cache, appartenenze, configurazione e disponibilità, attribuzione storica dei conti. API/browser su dati sintetici; concessioni Connect e accettazione di produzione separate |
| 8 | Conto unico | [Implementato e verificato localmente](operational-order-step-8.md): righe stabili condivise con agenda, conto aperto e checkout atomici, revisioni, adattatori legacy e riconciliazione esplicita; campi e totale storico preservati su 14 tabelle. Provider e produzione separati |
| 9 | Prezzi, IVA, magazzino | [Implementato e verificato localmente](pricing-inventory-step-9.md): motore monetario, anteprima, storici dei prezzi, aliquote indipendenti, giacenze e movimenti per sede, consumi espliciti, resi e trasferimenti; campi e valori storici preservati su 15 tabelle. API/browser sintetici; produzione e provider separati |
| 10 | Prenotazione e incasso | [Chiuso tecnicamente in locale](booking-payments-step-10.md): prenotazione multipla e singola, risorse e orari server, conto unico, incassi/rimborsi espliciti, modifiche/annullamenti e cassa idempotenti, esecutori dichiarati, recupero dopo reload e configurazioni concorrenti verificati. Sei migrazioni applicate al Docker locale; 42 tabelle e 471 colonne originarie preservate. Provider, account e produzione esclusi |
| 11 | WhatsApp Connect | [Implementato e installato localmente](whatsapp-connect-step-11.md): console, connessione/QR, conversazioni, invio manuale recuperabile, autorizzazioni e configurazione collegati allo Step 12 con SDK 0.12.0-rc.2. SDK reale e provider sintetico collaudati; pairing, ricezione/consegna, interazioni e webhook pubblico reali restano da accettare |
| 12 | Automazioni appuntamenti | [Implementate, verificate e installate localmente](appointment-automations-workflow-step-12.md): promemoria, consenso per prenotazione, deleghe distinte, pulsanti monouso, conferma/richiesta modifica/annullamento, mancata risposta, eventi selezionabili e cinque testi, ritiro durevole e monitoraggio. 391 test, 36 gruppi HTTP dedicati, browser nei quattro formati, migrazioni e ripristino su copia. Nove migrazioni applicate senza avviare invii storici. Accettazione provider/dispositivo separata; nessun account o messaggio reale |
| 13 | Dashboard e responsive | [Chiusura tecnica locale](dashboard-responsive-step-13.md): report, IVA, margine/copertura materiali, giacenze, elenco professionisti e ambiti verificati. Calendario nei quattro formati e cinque percorsi completi in ciascuna viewport tablet, inclusi acconto/saldo misto/rimborso e recuperi. Immagini corrispondenti alle build installate l’11 novembre. Dispositivi fisici e accettazione aziendale separati |
| 14 | Validazione commerciale | [Ripristino tecnico e rilascio locale verificati](release-readiness-step-14.md): copia corrente, 54 tabelle/632 colonne preservate, media sintetici, ritorno all’immagine precedente prima di nuove scritture e ripristino a freddo. Backup coordinato del passaggio locale conservato. Provider, webhook pubblico, dispositivi fisici, produzione e accettazione commerciale restano aperti; account esclusi |

Lo Step 8 precede magazzino e automazioni perché questi devono riferirsi a righe, importi e stati autorevoli. Default progettuali del piano: arrotondamento al centesimo per riga, costo medio ponderato, sconto complessivo proporzionale con distribuzione deterministica dei centesimi residui.

Aggiornamento contratti Connect verificati nel checkout: amministrazione delegata disponibile tramite `/v1/team` e relativi metodi SDK, con `team.manage` obbligatorio per le scritture; provisioning assistito disponibile con schema 011 e ConnectOnboardingSource 0.9.0. Restano da integrare nella rispettiva fase e non sono dichiarati attivi sull’installazione operativa. Il contratto di delega revocabile senza sessione personale è ora consegnato con SDK candidato 0.12.0-rc.2, incluso il ritiro del comando, e integrato nei flussi appuntamento collaudati dal consumer su provider sintetico. Il runtime Connect/runner e i flussi reali restano da accettare. La facciata SDK e il recupero dopo rifiuto password sono stati consegnati nella 0.10.0/schema Connect 012; ALORA ha installato il pacchetto e verificato store/adattatori su PostgreSQL temporaneo. Gli handler HTTP usano ora il modulo comune, con collaudi API/provider isolati passati. Il caso di attivazione segnalato è risolto; resta l’accettazione operativa/browser.

## Passaggi di fase

Aggiornamento del 6 novembre 2026: l’utente richiede «procedi con la chiusura degli step lascia perdere gli account». Registrata la chiusura tecnica degli step 5 e 6 nel relativo [verbale](chiusura-step-5-6.md); i collaudi account non confermati sono rinviati e non diventano prove superate. Il successivo «procedi» autorizza lo Step 7, ora implementato con [verifiche locali distinte](locations-sectors-step-7.md). Gli step 8–14 erano ancora da implementare a quella data.

7 novembre 2026: «procedi con il resto» autorizza la prosecuzione degli step rimanenti senza una nuova domanda a ogni fase; resta escluso il lavoro sugli account Connect. Step 8 completato tecnicamente nel runtime locale con [evidenze](verification/operational-order-step-8.json); Step 9 completato a sua volta con [evidenze locali](verification/pricing-inventory-step-9.json). Seguono gli step 10–14; l’accettazione di produzione resta aperta.

### Cronologia precedente

`evolve.md` richiede autorizzazione prima di ogni passaggio di fase. Il 25 ottobre l’utente ha autorizzato «procedi con il piano» dopo aver confermato l’accesso Connect e il passaggio allo SDK npm. Lo Step 5 è avviato; non viene dichiarato concluso. I collaudi operativi riservati all’utente e le prove di produzione restano esplicitamente aperti e non vengono sostituiti da mock o compilazioni. Il piano complessivo resta attivo.

Aggiornamento Step 5, 25 ottobre: il titolare può associare esplicitamente il proprio account a un professionista attraverso Accessi squadra, mantenendo intatti ruolo, permessi e credenziali. Verificate su PostgreSQL sintetico conservazione della riga User e atomicità; dettagli in [team-step-5.md](team-step-5.md). Il contratto di creazione delegata in Connect e il collaudo dell’utente restano necessari prima della chiusura dello Step 5.

26 ottobre: candidata SDK 0.11.0 adottata da tarball su autorizzazione esplicita dell’utente; creazione delegata integrata nello Step 5 con profili inattivi riprendibili per ID. SDK pubblico npm non aggiornato da questo lavoro. Aggiornamento successivo del 26 ottobre: server locale schema 014 verificato; percorso centrale C1 superato con provider/browser ALORA reali e cleanup riconciliato. [Evidenze](verification/team-real-consumer.json). I sottocasi e l’accettazione finale restano aperti.

8 novembre 2026: Step 10 chiuso tecnicamente sul Docker locale dopo rehearsal, confronto degli artefatti e nuovo backup. Tre servizi sani e dati originari invariati. La prosecuzione autorizzata riguarda ora gli step 11–14; nessuna operazione sugli account Connect.

11 novembre 2026: collegamento completo tra eventi, promemoria e azioni cliente installato nel Docker locale, con selezione degli eventi e cinque testi WhatsApp. Backup coordinato, confronto di 54 tabelle/632 colonne e contenuto logico SDK invariato, tre servizi sani. [Resoconto e limiti](appointment-automations-workflow-step-12.md). Restano accettazioni provider, dispositivo, webhook pubblico e commerciali, senza riaprire i collaudi account esclusi dall’utente.

11 novembre, aggiornamento successivo: su «vai tu su ../eulab connect» questo agente ha installato il runtime centrale compatibile (API, runner e schema 015), dopo prove isolate, backup coordinato e confronto dei dati. Account e ruoli preservati. [Passaggio e limiti](verification/connect-runtime-015-local.json). Restano origine webhook HTTPS pubblica e collaudo sul dispositivo.
