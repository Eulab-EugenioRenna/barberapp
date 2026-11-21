# Step 12 — Avanzamento degli eventi e delle automazioni

**Collegamento applicativo implementato, verificato e installato nel Docker locale l’11 novembre 2026.** Promemoria, azioni cliente, eventi selezionabili, cinque testi WhatsApp, consenso per prenotazione, deleghe distinte, ritiro e monitoraggio sono descritti nel [resoconto corrente](appointment-automations-workflow-step-12.md) e nelle [evidenze correnti](verification/appointment-automations-workflow-step-12.json). SDK 0.12.0-rc.2; nove migrazioni notifiche/automazioni applicate, nessun piano o consenso storico inferito. Pairing, provider reale, webhook HTTPS pubblico, dispositivi e accettazione commerciale restano da verificare. Account e messaggi reali esclusi. Le sezioni sotto conservano la fondazione e i checkpoint del 9–10 novembre, superati dal resoconto corrente per stato del runtime e lavoro residuo.

## Eventi sul conto autorevole

`beginAppointmentEvents` acquisisce lo stato precedente sotto il lock operativo dell’azienda e registra il risultato finale prima del commit. È usato da creazione interna/pubblica, modifica completa e singola, annullamento, transizione di stato e cassa, compreso il collegamento storico di una prestazione. Gli ID stabili di conto, righe e appuntamenti restano autorevoli. Un replay non genera un nuovo evento; una modifica alle sole note o un acconto non crea un cambiamento di calendario.

Gli eventi comuni di una sequenza sono raggruppati sul conto, senza un messaggio di creazione per ogni servizio. Le assegnazioni del personale mantengono il riferimento alla singola prestazione. Le esecuzioni registrate dalla cassa sono eventi di completamento e non diventano nuove prenotazioni future. La snapshot conserva servizi interessati e piano del conto, durata, risorse, ambiti e autore; non conserva note CRM, prezzi o dati fiscali. I recapiti del cliente rimangono dati interni del processo, con proiezioni distinte per i destinatari.

`NotificationDomainEvent` è un’outbox di dominio in PostgreSQL, senza una seconda sessione o outbox WhatsApp. Identità e contenuto sono immutabili; completare la preparazione chiude l’insieme delle consegne. Nessuna migrazione genera eventi storici o interpreta un vecchio pagamento come notifica da inviare.

## Preparazione, coda e invio

Il materializzatore acquisisce un evento con un lock SQL e prepara `NotificationHistory` e `NotificationInbox` nella stessa transazione. Un errore dopo l’inserimento dello storico annulla anche inbox e checkpoint. Ogni destinatario/canale ha una chiave stabile; ruoli sovrapposti non creano due consegne allo stesso recapito per lo stesso evento. Preferenze, template e ambiti vengono letti dalla transazione, senza dipendere da Redis.

BullMQ resta la coda esistente. Un recupero periodico ricostruisce i suoi job dal database; l’indisponibilità di Redis non cancella gli intenti. Prima dell’effetto esterno il worker acquisisce un token e una scadenza persistenti. Un secondo worker o un job ripetuto non richiama il provider. Un processo interrotto durante il tentativo produce `uncertain` alla scadenza, senza tornare automaticamente a `pending`.

Un rifiuto certamente precedente all’invio può avere un nuovo tentativo sullo stesso storico, dopo l’attesa prevista. Un esito ambiguo resta da verificare. In Nodemailer il solo codice `CONN` non prova che il messaggio non sia partito: anche la chiusura dopo `DATA` può usarlo. Sono classificati come precedenti all’invio soltanto il fallimento esplicito della connessione TCP, DNS, autenticazione o envelope. I messaggi SMTP sono testo semplice e ammettono un solo indirizzo di destinatario valido. La risposta HTTP 500 di un webhook non è interpretata automaticamente come mancato effetto.

Le consegne esterne legacy senza intento durevole non vengono considerate sicure da ripetere. Lo storico conserva i valori precedenti e la consultazione distingue la base `legacy_unknown` da `durable_intent`.

## Ambiti e recapiti

Prima dell’invio vengono ricontrollati attività, policy/provider abilitato, preferenze personali, recapito originale e stato corrente del piano. Un indirizzo cambiato non sostituisce il destinatario del vecchio intento. Una riprogrammazione superata non viene inviata come se fosse ancora corrente; una revisione solo finanziaria non invalida il calendario invariato.

Il riepilogo di un conto con più settori richiede accesso a tutti i suoi settori, sia nella selezione iniziale sia prima dell’invio. Inbox e storico seguono le appartenenze correnti anche dopo una revoca. Il personale riceve dati di pianificazione, senza contatti CRM o righe di altri professionisti nella proiezione personale. La consultazione dello storico espone dati di monitoraggio, non i payload completi o gli indirizzi dei clienti; l’inbox espone il messaggio e i suoi riferimenti. L’endpoint generico delle notifiche non può generare una falsa conferma di appuntamento senza la corrispondente operazione in agenda.

L’inizializzazione completa le preferenze mancanti senza sovrascrivere quelle configurate. Per nuove impostazioni, il canale email e le relative preferenze esterne partono disabilitati; le configurazioni preesistenti sono conservate. Nessun account o ruolo Connect reale è stato aggiornato.

## Checkpoint precedenti del 9 novembre

Le sezioni seguenti conservano evidenze dei candidati precedenti. Il [checkpoint consumer del 10 novembre](connect-automation-consumer-step-12.md) aggiorna SDK, deleghe, ricezione e console; non certifica ancora le automazioni attive.

## Prove e limiti del checkpoint del 9–10 novembre

### Template nella console

La pagina WhatsApp ospita l’editor dei testi email e delle notifiche nell’app, separato dai messaggi WhatsApp manuali. Richiede `notifications.manage` e appartenenza a tutti i settori dell’attività; una selezione di visualizzazione più ristretta non revoca l’accesso del titolare già autorizzato all’intera attività. Il caricamento è esplicito e non attiva canali o invii.

Sono disponibili i testi per gli undici eventi già prodotti dall’agenda, comprese riprogrammazione, arrivo, completamento e mancata presentazione. Le preferenze aggiunte per questi quattro eventi partono **disabilitate su entrambi i canali**; configurazioni e testi preesistenti non vengono sovrascritti. Non esiste ancora un template WhatsApp operativo per i promemoria.

L’anteprima accetta soltanto testo e segnaposto operativi ammessi, usa dati sintetici e richiama lo stesso renderer della preparazione delle notifiche. Non legge un cliente reale e non crea storico, eventi o invii. Oggetto/titolo hanno limite 200 caratteri e nessun ritorno a capo; il corpo ha limite 16.000. I campi disponibili sono nomi cliente/professionista, nome servizio/attività e inizio/fine/stato dell’appuntamento. Percorsi arbitrari, contatti, proprietà del prototipo e sintassi incompleta sono rifiutati. Gli orari di esempio sono dichiarati UTC, coerenti con i valori ISO dell’evento.

Il salvataggio confronta atomicamente `updatedAt` e lo avanza sempre: due finestre non possono sovrascrivere silenziosamente la stessa versione. Il conflitto conserva la bozza e richiede la ricarica esplicita. Qualsiasi modifica invalida l’anteprima; il testo viene mostrato senza interpretare HTML. Le notifiche già materializzate mantengono il proprio contenuto immutabile, e le preferenze non cambiano salvando un template.

**Sei gruppi HTTP e quattro browser** verificano questi comportamenti, inclusi concorrenza, tenant/permessi/appartenenze e quattro formati (1440×1050, 1180×820, 820×1180, 390×844). Le API dei template e PostgreSQL sono reali; nel collaudo di questa sezione soltanto le letture WhatsApp estranee all’editor sono risposte sintetiche vuote. Non è accettazione del provider. [Report dei template](verification/notification-templates-step-12.json).

### Policy salvata e calcolo degli orari

La console comprende ora una **bozza persistente** della policy: conferma iniziale, richiesta di risposta, anticipo (minuti effettivi), massimo di 1–5 promemoria, intervallo minimo, scadenza della risposta, fascia oraria e comportamento in assenza di risposta. Le opzioni di mancata risposta mantengono la prenotazione, con eventuale segnalazione allo staff; nessun annullamento automatico viene introdotto. Il salvataggio non esegue queste azioni. Il controllo di revisione è atomico anche alla prima creazione, e la bozza della seconda finestra resta conservata in caso di conflitto.

`AppointmentAutomationPolicy` conserva soltanto la configurazione corrente e l’autore locale derivato dalla sessione. La migrazione `20261109180000_appointment_automation_policy` non crea righe o lavoro sui dati esistenti. Un trigger SQL rifiuta autori fuori attività, cambio di tenant o salti di revisione. Lettura, modifica e anteprima richiedono `notifications.manage` e appartenenza all’intera attività; il filtro di visualizzazione non restringe l’autorizzazione già completa del titolare.

`planAppointmentReminders` calcola gli istanti senza scrivere eventi o prenotazioni. L’esempio usa un settore reale, il fuso corrente dell’attività, l’intersezione degli orari sede/settore/fascia di invio e le festività. Una chiusura anticipa l’orario al minuto utile precedente; la ricerca è limitata a 31 giorni. Non recupera un primo promemoria già passato, non accumula ripetizioni alla stessa chiusura e omette orari che violano distanza minima o scadenza. Il lead time è tempo trascorso, mentre gli orari di apertura sono locali: i test coprono entrambi i cambi dell’ora, compresa la seconda occorrenza di un’ora ripetuta. Nell’input locale dell’esempio, ore inesistenti o ambigue vengono rifiutate invece di scegliere implicitamente un offset.

**Questo non è ancora il pianificatore durevole degli invii.** La policy espone `status=draft` e `activationAvailable=false`; l’API non accetta campi di attivazione. Non sono ancora collegati ciclo di vita degli intenti, delega/licenza centrale, trasporto WhatsApp, risposte cliente o segnalazioni per mancata risposta. Il calcolo verrà riusato da quel percorso dopo la consegna del contratto Connect, senza duplicare la logica del calendario. Il salvataggio della policy non modifica preferenze/provider esistenti.

Sei gruppi HTTP, quattro browser nei quattro formati e 18 test del calcolo/validazione verificano il nuovo percorso. Passano **61 suite, 381 test e uno snapshot**; passano nuovamente i 18 gruppi della fondazione su database pulito. Il nuovo rehearsal conserva ancora 45 tabelle e 504 colonne originarie e verifica che la policy resti vuota dopo migrazione. I candidati `alora-step12-policy-candidate-{api,admin,booking}:20261109` corrispondono alle build host; sette verifiche di avvio isolato includono le tre migrazioni e i guard delle nuove API. Sono il checkpoint successivo ai candidati dei soli template, che restano conservati. [Evidenze della policy](verification/appointment-policy-step-12.json).

### Checkpoint della fondazione

- Migrazione e riapplicazione su backup leggibile del database corrente, poi ripristino in un database ricreato vuoto: invariati tutti i valori originari di **45 tabelle e 504 colonne**. Quattro gruppi SQL verificano immutabilità, tenant, identità della consegna, lease, chiusura degli intenti e cancellazione coerente dell’azienda nella copia isolata.
- **18 gruppi HTTP** su PostgreSQL reale e controller/servizi compilati: rollback dopo acknowledgement e inserimento evento; creazione multipla pubblica/interna; cambi di stato/cassa; concorrenza; Redis simulato indisponibile; ripresa dopo errore di materializzazione; rifiuto prima dell’invio; esito incerto; arresto reale di un processo figlio; recapiti, policy e ambiti revocati.
- **6 test di trasporto** con Nodemailer reale e server SMTP/webhook sintetici su loopback: accettazione, rifiuto prima di `DATA`, connessione rifiutata, singolo destinatario e risposta persa dopo ricezione. Non sono prove su SMTP o WhatsApp reali.
- **10 regressioni HTTP e 10 browser** degli step precedenti passate sul server isolato nel checkpoint precedente. Sul sorgente dell’editor sono ripetuti i **18 gruppi della fondazione, 60 suite, 363 test e 1 snapshot**; lint e tre build host passati. I provider dei collaudi di dominio sono sintetici; nessun destinatario reale viene contattato.

Le migrazioni candidate sono `20261109120000_notification_dispatch_states`, `20261109121000_notification_domain_outbox` e la successiva policy descritta sopra. Nessuna è applicata al database principale. Le immagini dei checkpoint template e policy sono costruite con cache e corrispondono ai rispettivi artefatti host. Avvio su rete Docker interna, PostgreSQL/Redis temporanei e nessun account conferma migrazioni, guard reali, dipendenze native e asset Nginx; i contenitori sono poi rimossi. Le immagini includono il lavoro dello [Step 13](dashboard-responsive-step-13.md), verificato separatamente, e non sono rilasciate nel runtime principale.

## Lavoro previsto al checkpoint del 10 novembre

I punti applicativi seguenti sono implementati e rilasciati localmente nel checkpoint dell’11 novembre; le verifiche su provider/dispositivo e la validazione commerciale restano aperte. L’elenco conserva la sequenza precedente, non lo stato attuale delle funzionalità.

1. Collegamento delle deleghe del consumer, ora verificate separatamente, al ciclo degli intenti e ai singoli canali di storico/inbox; verifica corrente dell’autorizzazione prima di ciascun effetto. Il contratto di ritiro è consegnato e integrato; resta da collegare la richiesta di ritiro all’invalidazione del piano/policy.
2. Attivazione della policy e promemoria durevoli: collegare il calcolo già verificato agli intenti delle prenotazioni, con invalidazione per modifica/revoca/scadenza, template WhatsApp compatibili con il contratto effettivo, recapito autorizzato e annullamento degli intenti superati. La configurazione in bozza e l’editor/anteprima email e nell’app sono già verificati.
3. Collegamento della ricezione Connect firmata e deduplicata, ora verificata, ai comandi di conferma, richiesta di modifica e annullamento correlati al destinatario, al piano e alla scadenza, con provenienza cliente distinta dal titolare e rifiuto delle risposte tardive.
4. Configurazione e gestione degli esiti nella console dello Step 11, collaudi UI e provider, confronto degli artefatti e rilascio locale con nuova conservazione dei dati.
5. Rilascio del candidato dello Step 13 e validazione commerciale dello Step 14. Quadrature e flussi responsive sono verificati su copie isolate nello Step 13; provider, dispositivi, produzione e attività sugli account restano gate distinti.
