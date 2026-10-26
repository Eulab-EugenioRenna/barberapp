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
| 3 | Catalogo delle funzioni | [Implementazione locale e integrazione isolata verificate](function-catalog-step-3.md): 24 funzioni, matrice versione 3 (team.manage e valori personali aggiunti nello Step 5), handler censiti, API/UI allineate; browser e registrazione nell’ambiente operativo pendenti |
| 4 | SSO e attivazione azienda | SSO adottato con SDK npm 0.10.0, poi candidata locale 0.11.0 per Step 5 e Connect schema 014. Accesso dopo migrazione confermato dall’utente; login consumer e revoca di sessione aperta verificati sul Docker reale. [Evidenze e limiti](auth-flow-step-4.md); rinnovo/scadenze completi e accettazione di produzione ancora da verificare |
| 5 | Ruoli e squadra | [In implementazione](team-step-5.md): gestione delegata di ruoli/assegnazioni/accessi con SDK esistente. Associazione facoltativa ad account esistenti e restrizioni locali configurabili implementate con migrazione additiva e ripristino locale provato. Dashboard personale con attività/valori autorizzati e aggiornamenti di stato implementata. Creazione/ripresa di nuovi account implementata con candidata SDK 0.11.0 autorizzata nello sviluppo; Connect effettivo schema 014/API/bootstrap verificato; creazione/login reali, policy, delega, revoca e recupero consumer passati su fixture temporanee. [Sottocasi e accettazione ancora aperti](team-step-5-acceptance.md) |
| 6 | Sicurezza personale | Profilo, password tramite SSO, MFA, dispositivi e sessioni; collaudo dei provider attivati |
| 7 | Sedi e settori | Configurazione e abilitazioni, sede/settore iniziali per legacy; attribuzione completa e query limitate agli ambiti autorizzati |
| 8 | Conto unico | Righe autorevoli condivise con l’agenda, adattatori legacy, riconciliazione di appuntamenti senza vendite e duplicati storici senza cambiare i totali |
| 9 | Prezzi, IVA, magazzino | Calcolo monetario centralizzato, prezzi storici, aliquote indipendenti, stock e movimenti per sede; quadratura di resi/rettifiche/trasferimenti |
| 10 | Prenotazione e incasso | Servizi multipli, risorse automatiche, modifiche contestuali, prodotti, acconti/saldi; sovraprenotazione e doppio incasso impediti |
| 11 | WhatsApp Connect | Pagina, QR, stato, conversazioni e permessi; pairing e operazioni verificati sul provider reale |
| 12 | Automazioni appuntamenti | Eventi durevoli, promemoria e risposte; prove di duplicazioni, timeout, revoche e risposte tardive, senza reinvii automatici degli esiti incerti |
| 13 | Dashboard e responsive | Report azienda/sede/settore/persona, selettori completi, cassa/agenda su tablet; totali riconciliati e collaudo dei formati previsti |
| 14 | Validazione commerciale | Onboarding e attivazione senza modifiche al codice, deployment, backup/ripristino, flussi reali e procedure verificate |

Lo Step 8 precede magazzino e automazioni perché questi devono riferirsi a righe, importi e stati autorevoli. Default progettuali del piano: arrotondamento al centesimo per riga, costo medio ponderato, sconto complessivo proporzionale con distribuzione deterministica dei centesimi residui.

Aggiornamento contratti Connect verificati nel checkout: amministrazione delegata disponibile tramite `/v1/team` e relativi metodi SDK, con `team.manage` obbligatorio per le scritture; provisioning assistito disponibile con schema 011 e ConnectOnboardingSource 0.9.0. Restano da integrare nella rispettiva fase e non sono dichiarati attivi sull’installazione operativa. La delega revocabile per automazioni senza sessione personale resta un requisito successivo da verificare/sviluppare. La facciata SDK e il recupero dopo rifiuto password sono stati consegnati nella 0.10.0/schema Connect 012; ALORA ha installato il pacchetto e verificato store/adattatori su PostgreSQL temporaneo. Gli handler HTTP usano ora il modulo comune, con collaudi API/provider isolati passati. Il caso di attivazione segnalato è risolto; resta l’accettazione operativa/browser.

## Passaggi di fase

`evolve.md` richiede autorizzazione prima di ogni passaggio di fase. Il 25 ottobre l’utente ha autorizzato «procedi con il piano» dopo aver confermato l’accesso Connect e il passaggio allo SDK npm. Lo Step 5 è avviato; non viene dichiarato concluso. I collaudi operativi riservati all’utente e le prove di produzione restano esplicitamente aperti e non vengono sostituiti da mock o compilazioni. Il piano complessivo resta attivo.

Aggiornamento Step 5, 25 ottobre: il titolare può associare esplicitamente il proprio account a un professionista attraverso Accessi squadra, mantenendo intatti ruolo, permessi e credenziali. Verificate su PostgreSQL sintetico conservazione della riga User e atomicità; dettagli in [team-step-5.md](team-step-5.md). Il contratto di creazione delegata in Connect e il collaudo dell’utente restano necessari prima della chiusura dello Step 5.

26 ottobre: candidata SDK 0.11.0 adottata da tarball su autorizzazione esplicita dell’utente; creazione delegata integrata nello Step 5 con profili inattivi riprendibili per ID. SDK pubblico npm non aggiornato da questo lavoro. Aggiornamento successivo del 26 ottobre: server locale schema 014 verificato; percorso centrale C1 superato con provider/browser ALORA reali e cleanup riconciliato. [Evidenze](verification/team-real-consumer.json). I sottocasi e l’accettazione finale restano aperti.
