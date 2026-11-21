# Automazioni — Passaggio dal collaudo consumer al runtime reale

**Aggiornamento dell’11 novembre 2026:** su istruzione dell’utente («vai tu su ../eulab connect») questo agente ha aggiornato API, runner e schema 015 nel Connect locale. Sono ora esposti nove percorsi automazioni; salute, heartbeat, migrazione ripetuta, backup e conservazione dei dati risultano verificati. [Evidenze del passaggio](verification/connect-runtime-015-local.json) · [Controllo corrente](verification/connect-runtime-automation-readiness.json). Restano origine HTTPS pubblica e accettazione sul dispositivo, senza operazioni sugli account. Il flusso ALORA è [installato e verificato](appointment-automations-workflow-step-12.md).

## Stato osservato prima dell’aggiornamento

La tabella conserva la diagnosi iniziale, superata dal passaggio descritto sopra. [Evidenza precedente](verification/connect-runtime-automation-readiness-before-015.json).

| Controllo | Risultato |
| --- | --- |
| Salute Connect, `/v1/health` nel container API | HTTP 200; `capacityVerified: false` |
| OpenAPI effettiva, `/v1/docs-json` | 118 percorsi; nessun percorso `automations` |
| API WhatsApp manuale | Presente nella specifica del runtime |
| Bundle API in esecuzione | Assenti controller/route delle automazioni e ritiro per chiave |
| Bundle runner in esecuzione | Assenti i riferimenti alle deleghe programmabili attesi dal contratto |
| Database effettivamente usato dall’API | `automation_delegations` assente; database confrontato con la configurazione API in memoria, senza esportare credenziali |
| ALORA installato | SDK `0.12.0-rc.2`; API sana; sorgenti del flusso coincidenti con le impronte del collaudo |
| Origine webhook ALORA | `ALORA_CONNECT_WEBHOOK_ORIGIN` non configurata; `PUBLIC_APP_URL` usa HTTP su loopback |

I bundle e le immagini sono identificati da hash nel report JSON. La sola salute di Connect non dimostra che le nuove operazioni siano disponibili. Il contratto consegnato richiede schema **015** e aggiornamento coerente di **API e runner**; il tarball SDK installato nel consumer non aggiorna quei servizi.

## Richiesta iniziale e autorizzazione successiva

Il testo seguente conserva il passaggio inizialmente preparato per il proprietario. L’utente ha poi autorizzato direttamente questo agente e il passaggio locale è stato eseguito.

> ALORA ha integrato lo SDK candidato 0.12.0-rc.2: deleghe distinte, invio sulla stessa outbox, riconciliazione, ritiro per chiave, webhook durevole e azioni cliente. Il consumer è installato su localhost:53020. La verifica read-only del Connect su localhost:8088 rileva API sana ma nessuna route automazioni in OpenAPI, nessun controller/ritiro nel bundle API e tabella automation_delegations assente nel database usato dall’API. Preparare e verificare il passaggio locale coerente di API, runner e schema 015 secondo packages/sdk/AUTOMATIONS.md e docs/AUTOMAZIONI-APPUNTAMENTI.md del progetto Connect. Conservare backup leggibile, dati, configurazioni, immagini precedenti, account e ruoli. Verificare migrazione ripetibile, stesse identità outbox/chiavi, ritiro prima/dopo acquisizione del runner, recupero webhook e segreto, eventi interattivi durevoli. Consegnare tag/hash e risultati effettivi del runtime. Non eseguire reset account, login, pairing o messaggi reali senza destinatario e operazioni esplicitamente autorizzati. Nessuna pubblicazione o produzione implicita.

La richiesta non è stata inviata ad altri agenti o servizi. L’audit iniziale era in sola lettura; l’aggiornamento locale successivo è stato eseguito da questo agente dopo l’istruzione esplicita dell’utente, preservando account e modifiche preesistenti.

## Ordine delle accettazioni successive

1. **Runtime centrale locale — eseguito.** API, runner e migratore aggiornati insieme; OpenAPI, immagini, schema 015, avvio e heartbeat verificati. Suite PostgreSQL 24/24 e migrazione su copia corrente, con rollback prima di nuove scritture e ripristino a freddo, passati. Questo prova il prerequisito locale; non una consegna sul dispositivo.
2. **Ricezione pubblica.** Individuare un’origine HTTPS controllata per ALORA. Il percorso del webhook è `/api/notifications/automation-webhooks/:id/events`; ID e segreto vengono creati/recuperati dal flusso SDK esistente, senza incollarli nei documenti. Verificare raggiungibilità, firma sui byte originali, timestamp e deduplicazione. Non attivare un tunnel o cambiare DNS/TLS implicitamente.
3. **Numero e destinatario controllati.** Identificare numero aziendale, licenza/capacità interattive e destinatario esplicitamente autorizzato per le prove. Il consenso di una prenotazione sintetica non autorizza un numero reale. I collaudi account esclusi dall’utente restano esclusi.
4. **Ciclo reale.** Su prenotazioni di prova concordate: consenso e attivazione espliciti, un solo invio con chiave originale, ricevuta autorevole, pulsanti sul dispositivo, firma/correlazione del callback e stato applicativo corrispondente. Verificare conferma, richiesta modifica senza spostamento automatico, annullamento secondo la soglia, avvisi selezionati e mancata risposta. Non interpretare `queued` come invio, ricezione o lettura.
5. **Invalidazione e ritiro.** Verificare cambio piano, revoca del consenso e arresto della policy prima dell’effetto, recuperando il comando originale. Se il runner ha già acquisito l’effetto, riportare `effect_started`; non dichiarare un annullamento effettivo. Verificare la revoca senza assegnare nuovi ruoli o cambiare password.
6. **Accettazione aziendale.** Titolare e personale verificano i percorsi concordati su dispositivi fisici; il risultato viene registrato separatamente dalle viewport browser. Produzione e prontezza commerciale richiedono le proprie evidenze.

Il piano complessivo resta aperto su queste accettazioni. Non vengono ripetuti login, recuperi password o modifiche agli account per tentare di superare il prerequisito di runtime.
