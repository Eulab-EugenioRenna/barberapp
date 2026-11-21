# Step 12 — Promemoria e azioni cliente

Aggiornamento dell’11 novembre 2026. Il collegamento applicativo è implementato: eventi del conto, pianificazione, invio tramite SDK Connect, risposta del cliente e monitoraggio condividono riferimenti durevoli. Il runtime Docker locale comprende queste funzioni; le regole restano disattivate finché il titolare non le configura e attiva esplicitamente. Nessun consenso, delega o piano è ricavato dai dati storici. [Evidenze e limiti](verification/appointment-automations-workflow-step-12.json).

## Configurazione e uso

Nella pagina **WhatsApp** il titolare configura la connessione e le autorizzazioni, poi i promemoria. Può scegliere messaggio iniziale, richiesta di risposta, anticipo, da zero a cinque promemoria, intervallo, fascia di invio, scadenza e comportamento in assenza di risposta. Conferma, annullamento e riprogrammazione sono selezionabili separatamente. Sono modificabili e visualizzabili in anteprima cinque testi: iniziale, promemoria, conferma, annullamento e riprogrammazione. L’anteprima usa lo stesso renderer dell’invio e mostra lo stato corrispondente all’evento.

Il salvataggio usa una revisione concorrente e riporta la configurazione in bozza, fermando i comandi superati. L’attivazione è un’operazione esplicita; considera solo nuovi eventi e ricontrolla connessione, ingresso webhook e deleghe necessarie. Non avvia messaggi sulle prenotazioni storiche. Il pulsante di arresto interrompe i piani e richiede il ritiro dei comandi ancora in coda. Le nuove scelte di conferma e annullamento partono disabilitate; per impostazioni precedenti resta il comportamento di riprogrammazione già previsto.

Nella prenotazione pubblica o interna il consenso WhatsApp è facoltativo e inizialmente non selezionato. Nell’editor di una prenotazione esistente si può registrarlo o revocarlo sul numero mascherato. Il consenso riguarda quella prenotazione, quel cliente e quel numero internazionale: non deriva dal consenso marketing o dalla sola presenza del telefono. La risposta persa dopo un salvataggio conserva il comando originale per il recupero dopo reload.

Il monitor distingue piani di promemoria, avvisi di evento e richieste da gestire. Mostra gli ultimi 50 elementi e separatamente fino a 50 richieste aperte, anche più vecchie. La presa in carico conserva autore e revisione; non sposta l’agenda. I messaggi accettati da Connect restano **in coda** fino alla ricevuta autorevole di invio. La schermata distingue anche ritiro, errore ed esito da verificare.

## Comportamento delle risposte

| Azione | Effetto applicativo |
| --- | --- |
| Conferma | Conferma le righe future ancora modificabili del conto e chiude la risposta una sola volta. Un eventuale avviso di conferma non apre un nuovo ciclo di pulsanti. |
| Richiedi modifica | Registra una richiesta visibile al personale; conserva data, risorse e importi. |
| Annulla con almeno 24 ore di anticipo | Applica la regola esistente alle sole righe future ammissibili, con provenienza cliente. Prestazioni eseguite, acconti, movimenti e giacenze restano conservati. |
| Annulla sotto le 24 ore | Registra una richiesta al personale e mantiene la prenotazione. |
| Nessuna risposta | Scade il piano e mantiene la prenotazione. L’eventuale avviso al personale richiede la propria autorizzazione e le preferenze del canale. |

Le risposte arrivano attraverso il webhook firmato di Connect, sui byte originali, con timestamp e deduplicazione persistente. I pulsanti sono opachi e monouso, vincolati a piano, cliente, numero, archivio, numero aziendale e scadenza. Testo libero, altri numeri, eventi non verificati, risposte scadute e pulsanti di una vecchia riprogrammazione non diventano comandi di agenda. Due risposte concorrenti sono serializzate dal lock operativo dell’azienda. Non si usa l’identità del titolare come autore del comando cliente.

## Persistenza e autorizzazioni

`Sale`, `SaleItem` e `Appointment` restano i dati autorevoli. Gli eventi sono registrati nella stessa transazione del dominio; un pagamento senza cambi di calendario non invalida il piano. Il tempo dell’evento viene acquisito dopo il lock operativo, evitando di perdere una prenotazione rimasta in attesa durante l’attivazione delle regole.

I piani e gli avvisi usano lo storico `NotificationHistory`, BullMQ e la stessa outbox Connect. Il comando cifra e congela destinatario, contenuto, delega, identità e chiave originali. Il recupero legge la ricevuta dello stesso comando; un esito incerto non genera un nuovo invio. Il ritiro tramite `automations().withdraw(...)` distingue ritiro effettivo, stato già terminale e tentativo già acquisito dal runner: quest’ultimo non viene dichiarato annullato.

Gli avvisi di conferma e annullamento hanno un contesto immutabile indipendente dal ciclo di risposta, ma riutilizzano lo stesso invio durevole. Un evento arretrato deve coincidere con calendario e autorizzazione al contatto acquisiti all’origine: non adotta un consenso successivo, un nuovo numero o una diversa riprogrammazione. Revoca del consenso, cambio di numero, piano superato e arresto della policy invalidano i comandi pertinenti senza modificarne il destinatario.

Le deleghe di invio WhatsApp, comandi di agenda, notifiche nell’app ed email sono distinte. Il processo in background verifica autorizzazioni locali e centrali correnti, senza token o refresh del browser. La delega WhatsApp non concede modifiche all’agenda; una risposta cliente non autorizza automaticamente email o notifiche al personale. Payload completi, credenziali e numeri non compaiono nelle proiezioni di monitoraggio.

SDK installato da `vendor/eulab-connect-0.12.0-rc.2.tgz`, con integrità nel lockfile e installazione offline verificata. Nel checkpoint iniziale ALORA non veniva modificato Connect. Su successiva istruzione esplicita dell’utente questo agente ha aggiornato anche [API, runner e schema 015 locali](verification/connect-runtime-015-local.json), preservando i dati; nessuna pubblicazione del pacchetto eseguita. I limiti del formato sono quelli del contratto SDK: i testi espansi troppo lunghi risultano esclusi con motivo visibile, senza troncamento né invio parziale.

## Verifica e aggiornamento locale

Le prove usano API e servizi compilati, PostgreSQL reale, SDK reale e provider/OIDC sintetici su loopback. Sono passati **62 suite, 391 test e uno snapshot**, lint e le tre build; **20 gruppi HTTP** del ciclo cliente e **16** degli avvisi/eventi; **5 gruppi browser** della console, **2** del contatto e **3** del booking pubblico nei quattro formati. Le regressioni comprendono 16 script dei domini precedenti e i tre script SDK: webhook (6 gruppi), deleghe (9), ritiro (8), oltre alla base manuale (9).

I casi includono rollback dopo inserimento del comando, crash e risposta persa, risposte concorrenti, riconciliazione senza reinvio, cambio recapito, revoche, Redis indisponibile, riprogrammazione, prestazioni già eseguite, richieste tardive, mancata risposta, avvisi senza nuovo ciclo interattivo e attivazione concorrente con una prenotazione. L’interfaccia verifica anche conflitto di revisione, mantenimento della bozza e recupero dopo reload.

La migrazione aggiuntiva `20261111200000_appointment_event_notices` rende facoltativo il collegamento al piano per gli avvisi e aggiunge il contesto immutabile. Non genera eventi o consensi, conserva i collegamenti esistenti e resta applicabile una seconda volta. Sulla copia precedente all’aggiornamento sono invariati i valori di **54 tabelle e 632 colonne originarie**. La conservazione dell’attività prenotata continua a impedire cancellazioni distruttive dell’azienda.

Le tre immagini Docker corrispondono agli artefatti host verificati. Avvio completo isolato (11 gruppi) e ripristino (6 gruppi) verificano entrypoint, client Prisma Linux, dipendenze native, guard, asset, media e rollback verso l’immagine precedente, senza porte pubbliche o provider reali. Il rollback è provato prima di nuove scritture o effetti esterni; non autorizza a sovrascrivere dati successivi con un backup vecchio.

Il passaggio locale conserva immagini precedenti, configurazione privata e backup coordinati di database e upload, acquisiti fermando i tre servizi applicativi. Dopo il passaggio sono verificati salute, asset, guard anonimi, migrazioni, dati e media. Il normale rinnovo cifrato del record tecnico SDK è confrontato sul contenuto decifrato in memoria, senza esportare credenziali; eventuali variazioni di cifratura e TTL sono distinte dai dati gestionali. Dettagli e hash sono nel report JSON. Nessuna operazione usa account reali, modifica ruoli/password o invia messaggi a destinatari reali.

## Accettazioni ancora aperte

Il collaudo sintetico prova il collegamento ALORA e il contratto SDK. Il successivo aggiornamento locale di API/runner/schema 015 è verificato separatamente. Non prova pairing di un dispositivo, licenza e capacità interattive del numero, raggiungibilità HTTPS del webhook, consegna/ricezione effettiva o uso dei pulsanti sul dispositivo. Queste accettazioni, i dispositivi fisici e l’accettazione commerciale restano separate. Account, invii reali e produzione rimangono esclusi dall’intervento corrente.
