# Step 14 — Ripristino tecnico e prontezza al rilascio

**Ripristino tecnico e aggiornamento locale verificati l’11 novembre 2026; accettazione commerciale aperta.** Il runtime comprende console WhatsApp, dashboard responsive e il [collegamento tra promemoria e azioni cliente](appointment-automations-workflow-step-12.md), con SDK 0.12.0-rc.2 e nove migrazioni notifiche/automazioni. Avvio del candidato, ritorno all’immagine workflow precedente e ripristino a freddo sono verificati su copia isolata. Account reali, messaggi reali e produzione restano esclusi. [Evidenze correnti e checkpoint precedenti](verification/release-restore-step-14.json).

## Prova eseguita

`scripts/verify-release-restore.mjs` acquisisce un nuovo `pg_dump -Fc` del database corrente e ne verifica la leggibilità con `pg_restore --list`. Legge anche l’archivio del volume upload. Non arresta i servizi principali, non ne modifica configurazioni e non scrive nel database sorgente.

Il ripristino usa PostgreSQL e Redis su tmpfs, una rete Docker `internal` senza porte host e volumi media temporanei appartenenti soltanto alla prova. Non riceve configurazione o chiavi reali Connect. I servizi API usano SMTP locale non disponibile e non possono raggiungere provider esterni. Nessun login viene eseguito: i record account copiati restano dati da confrontare, senza nuove sessioni o cambi di ruolo/password.

Il volume upload sorgente era vuoto. La prova ne verifica il ripristino vuoto e aggiunge **tre file sintetici soltanto nello staging isolato**: PNG, nome Unicode con permessi `0600` e file vuoto, più un link simbolico interno al volume. Un secondo archivio ripristina questi file in volumi nuovi. Manifest di percorsi, tipi, modi, link e hash del contenuto sono confrontati; tutti e tre i file sono anche letti via HTTP dal server reale. Non è una prova su upload reali preesistenti non vuoti.

La sequenza verificata è:

1. Ripristino del backup in database vuoto e snapshot delle colonne originarie.
2. Avvio tramite entrypoint normale del candidato `alora-step12-events-candidate-api:20261111`: applicazione della nona migrazione sulle otto notifiche/automazioni già presenti, salute, lettura dei file ripristinati e osservazione oltre due intervalli del recupero outbox.
3. Arresto del candidato e confronto dei dati: **54 tabelle e 632 colonne originarie invariate**, nessun evento di dominio, policy, consenso, delega, comando o avviso inferito, media invariati.
4. Avvio dell’immagine workflow precedente, realmente in uso prima del passaggio, sulla copia aggiornata: salute e file serviti correttamente, colonne originarie e media ancora invariati.
5. Nuovo database vuoto, ripristino del backup iniziale e nuovo volume media: l’immagine workflow precedente si avvia sul ripristino a freddo. Le otto migrazioni notifiche/automazioni originarie sono presenti, quella degli avvisi assente; dati e file coincidono con i rispettivi archivi.
6. Controllo finale di immagini, salute, schema e upload dei servizi principali. Rimozione di tutti i contenitori, volumi e rete creati dalla prova; conservazione degli archivi e delle evidenze private in `.local/step14/`.

Il rollback binario è provato **prima di nuove scritture applicative o effetti provider sul candidato**. Non dimostra compatibilità dell’immagine precedente con eventuali nuovi stati prodotti dopo l’apertura agli utenti. Il ripristino di un backup precedente non è una procedura automatica autorizzata per cancellare nuove prenotazioni, incassi o risposte.

## Passaggio locale eseguito

Il passaggio applicativo era già autorizzato nel piano. Le immagini collaudate coincidono con gli artefatti host. Quelle precedenti sono conservate con tag `alora-workflow-before-events-{api,admin,booking}:20261111t115220z`; i checkpoint Step 9/10 restano disponibili.

API, amministrazione e booking pubblico sono stati fermati per acquisire backup coordinati di database e upload, insieme alla configurazione privata necessaria al ripristino. Gli archivi sono leggibili e conservati con accesso ristretto; chiavi e variabili non sono pubblicate. Questo backup coordinato è distinto dal rehearsal, che legge la sorgente senza congelarla.

Sono stati aggiornati soltanto i tre servizi applicativi; l’entrypoint ha applicato la migrazione pendente senza reset o seed. PostgreSQL, Redis, Mailhog, Nginx, upload e container Connect sono preservati. Salute dei tre servizi, HTML/JavaScript, guard anonimi, nove migrazioni e conservazione delle 632 colonne originarie risultano verificati.

I valori di 53 tabelle sono invariati. Il solo record tecnico `connect_sdk_records` rinnova normalmente cifratura e TTL: numero di record, namespace e contenuto decifrato sono invariati. Il confronto avviene in memoria senza esportare credenziali. Account, sessioni, conti, incassi e media restano conservati; nessun consenso, evento, delega o piano è inferito e nessun messaggio reale è inviato. Backup ed evidenze private sono in `.local/step12/local-events-rollout-20261111T115220Z/`; hash e confronti sono nel [report corrente](verification/appointment-automations-workflow-step-12.json).

Un eventuale ripristino deve partire da una destinazione vuota verificata, conservando lo stato da diagnosticare. Dopo nuove scritture o effetti esterni occorre riconciliare o correggere in avanti; non sostituire silenziosamente il database con un backup più vecchio.

Redis di questa prova è vuoto. Le code provider reali non sono riprodotte. La nuova outbox di dominio ricostruisce i propri job dal database; gli invii legacy senza intento durevole non vengono reinterpretati come sicuri da ripetere. La gestione operativa delle code reali richiede la verifica dei relativi esiti prima del passaggio.

## Requisiti ancora da chiudere

| Requisito | Evidenza corrente | Stato residuo |
| --- | --- | --- |
| Configurazione attività, sedi, settori, cataloghi e ambiti | Step 5–10 e relativi collaudi locali | Operazioni account reali rinviate dall’utente |
| Prenotazione online/interna, conto, cassa, incassi e magazzino | Step 10 rilasciato localmente; prove sintetiche HTTP/browser | Accettazione aziendale distinta |
| Report e uso desktop/tablet/telefono | Step 13 installato localmente e flussi nei quattro formati | Dispositivi fisici e accettazione aziendale |
| WhatsApp manuale | Step 11 con SDK reale e provider sintetico | Pairing/consegna/interazioni reali non attestati |
| Promemoria, conferme, risposte e mancata risposta | Deleghe distinte, intenti, azioni cliente, avvisi e monitor installati; 36 gruppi HTTP dedicati e browser | API/runner/schema 015 ora aggiornati localmente; restano pairing/licenza, webhook HTTPS pubblico e pulsanti sul dispositivo reale |
| Backup e ripristino | Sei gruppi del rehearsal, tre avvii API, media sintetici e backup coordinato del passaggio locale | Infrastruttura di produzione, DNS/TLS, code provider e chiavi/configurazioni esterne non coperte |
| Attivazione azienda tramite Connect senza modifiche al codice | Contratto/onboarding degli step precedenti | Accettazione su account reali rinviata; non sostituita dal solo avvio API |
| Prontezza commerciale | Evidenze tecniche separate e limiti espliciti | Non certificata; non coincide con build o ambiente sintetico |

La separazione di responsabilità resta quella del [contratto SDK](connect-sdk-integration-contract.md): il repository e i servizi Connect sono affidati al loro proprietario. Il contratto SDK è consegnato e integrato nel consumer. Su successiva istruzione esplicita dell’utente questo agente ha aggiornato e verificato anche [API/runner/schema 015 locali](verification/connect-runtime-015-local.json); dispositivo, webhook pubblico e distribuzione in produzione restano verifiche separate. Account, destinatari reali e produzione restano fuori dalle operazioni svolte.
