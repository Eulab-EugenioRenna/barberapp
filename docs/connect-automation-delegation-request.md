# Richiesta di contratto Connect — delega revocabile per automazioni

Proposta da implementare nel proprietario API/SDK Connect. **Non è un contratto già disponibile e non autorizza modifiche agli account.** Le automazioni ALORA dello Step 12 e il loro rilascio restano incompleti finché il contratto non è consegnato e collaudato. Il limite di responsabilità attuale è in [connect-sdk-integration-contract.md](connect-sdk-integration-contract.md#accettazione-richiesta-allsdk) e nella [roadmap](evolution-roadmap.md#decisioni-fissate).

## Evidenza verificata nel checkout

Il 9 novembre 2026, `apps/api/src/whatsapp.service.ts` conserva il token personale cifrato nell'outbox manuale; `apps/runner/src/main.ts` lo verifica prima dell'effetto. La credenziale di installazione non sostituisce il subject. `whatsapp-bot.service.ts` dispone di una delega persistente specifica per il bot, con autore/revisione e nuova verifica di `whatsapp.manage`/`whatsapp.send`; non è un'autorizzazione generale ai promemoria di un'applicazione. ALORA non deve copiare il bot o usare un refresh token UI per eseguire lavoro giorni dopo.

## Consegna richiesta

1. **Delega esplicita:** un utente con diritti correnti autorizza l'applicazione server collegata a una singola installazione. Persistenza di ID, autore, installazione/app, finalità, funzioni ammesse, revisione, scadenza e revoca; nessuna assegnazione di ruoli o funzioni agli utenti. Nessun subject o admin flag viene accettato dal job.
2. **Funzioni e licenza correnti:** l'emissione non amplia i permessi esistenti. Per WhatsApp richiedere gli attuali diritti di gestione/invio e la capacità/licenza corrente. Il runner ricontrolla delega, installazione, autore attivo e funzioni prima di ogni effetto. La revoca vale anche per l'outbox già accettata. L'autorizzazione per notifiche applicative/email deve essere distinta e riferita alle funzioni del catalogo dell'app; una delega WhatsApp non autorizza implicitamente altri canali.
3. **API/SDK comuni:** metodi per autorizzare, leggere/verificare e revocare la delega, più invio/stato WhatsApp con quella delega; nomi e route finali sono del provider. Le credenziali restano cifrate nello store server SDK/consumer, mai nel browser, nei log o nelle proiezioni API. UI ALORA riceve soltanto stato, scadenza e motivo sicuro di mancata autorizzazione.
4. **Recupero senza duplicati:** creazione delega e invio usano chiavi stabili vincolate ad autore/installazione e payload. Una risposta persa non deve creare un'altra delega o un altro messaggio. Il contratto deve definire la ripresa della credenziale senza ampliamento dell'ambito, senza rotazione ambigua e senza esporla a un altro attore. Un comando in conflitto viene rifiutato.
5. **Outbox esistente:** riusare outbox, archivio, sessione del numero e runner Connect. Distinguere accettato in coda, inviato, fallimento certo ed esito incerto. La stessa chiave consente lettura dello stato autorevole; nessun reinvio automatico su un esito ambiguo o su un worker interrotto.
6. **Risposte:** consegnare/verificare le capacità SDK per i formati interattivi e l'ingresso firmato verso il consumer, con installazione/event ID stabili e verifica della firma sul corpo originale. ALORA conserva deduplica e correlazione a destinatario, conto, piano/revisione e scadenza; il provider non conosce il dominio appuntamenti ALORA.
7. **Compatibilità e migrazione:** aggiunta separata a schema e SDK, contratti manuali e delega bot esistenti conservati. Rehearsal su backup leggibile con campi originari invariati e riapplicazione idempotente. Pacchetto candidato locale per i test consumer; nessuna pubblicazione npm o rilascio del Connect operativo impliciti.

## Collaudi richiesti

API, SDK, consumer e runner su database, utenti, installazioni e provider sintetici: autorizzazione e recupero concorrente; scope incrociato; funzione mancante; credenziali assenti dal browser/audit; scadenza; revoca di delega/utente/ruolo/funzione/licenza/installazione prima dell'invio; token UI scaduto con delega valida; doppia esecuzione; risposta persa dopo enqueue; crash prima/dopo effetto; esito incerto senza nuova chiave; tentativi di usare una delega per un'altra finalità; webhook falso, duplicato o di altra installazione.

Un provider sintetico non prova pairing, consegna o interazioni sul dispositivo reale. Questi restano collaudi separati. Non usare l'account admin o indirizzi reali come fixture.

## Parte ALORA già pronta

Gli eventi vengono registrati con conto/agenda nella medesima transazione; materializzazione di storico/inbox atomica; recupero da Redis e acquisizione persistente del tentativo; esiti incerti senza reinvio; ricontrolli di piano, destinatario, preferenze e ambiti. Le prove includono arresto reale di un worker sintetico. Mancano la delega centrale, pianificazione/policy/template complete e ingresso risposte cliente; non sono dichiarati operativi.

## Precisazioni dal protocollo webhook esistente

Verifica in sola lettura del 9 novembre 2026, dopo la consegna della policy in bozza ALORA:

- Lo SDK installato 0.11.0 esporta già `verifyWebhook(secret, rawBody, timestamp, received, now)`. Il runner usa `x-eulab-event-id`, `x-eulab-timestamp` e `x-eulab-signature`; firma HMAC-SHA256 di `timestamp.rawBody`, con tolleranza temporale di cinque minuti nel verificatore. Questo componente va riusato, senza riscrivere HMAC in ALORA. Non prova da solo che l’intera integrazione risposte sia disponibile.
- In `apps/runner/src/main.ts`, il body consegnato da `hookWorker` contiene `id`, `kind`, `createdAt`, `installationId` e `payload`. Per `message.received`, il payload deriva da `providerId`, `chatId`, `kind` e `body`; non contiene sessione, verso del messaggio o timestamp originale del messaggio. `record` è chiamato anche da `onAnyMessage`, mentre il relativo evento non distingue `fromMe`. Il consumer non deve trattare qualsiasi evento con quel nome come un comando del cliente. Il contratto deve consegnare provenienza e identificatori sufficienti per vincolare installazione, connessione, destinatario, messaggio e tempo di ricezione.
- Sempre in `record`, l’evento webhook è creato solo con `emit && result.rowCount`. Il ramo `interactive_response` può aggiornare un messaggio già inserito senza creare un nuovo evento. Dal flusso del codice deriva quindi il caso da collaudare: messaggio ordinario arrivato prima della normalizzazione interattiva, stesso provider ID, selezione aggiunta dopo deduplica. La risposta selezionata deve produrre una consegna durevole correlabile, una sola volta. Questa è una deduzione dal codice, non un fallimento riprodotto sul dispositivo reale.
- `POST .../webhooks` in `apps/api/src/whatsapp.controller.ts` genera ID e segreto nuovi per ogni chiamata; non accetta una chiave idempotente. `GET .../webhooks` non restituisce il segreto. Una risposta persa dopo commit non consente al consumer di recuperare semplicemente la credenziale originaria. Occorre un contratto di creazione/recupero e relativi metodi SDK, vincolati all’attore autorizzato, prima di una configurazione automatica affidabile.
- Il trasporto attuale rifiuta destinazioni non HTTPS/443 e indirizzi privati. Il collaudo loopback del consumer resta sintetico; un endpoint localhost non può essere dichiarato raggiungibile dal runner reale. La raggiungibilità pubblica e la configurazione dell’endpoint restano prove separate, senza cambiare impostazioni reali durante lo sviluppo.

Collaudi aggiuntivi richiesti: risposta ordinaria seguita dalla selezione normalizzata con stesso provider ID; messaggio `fromMe`; evento senza sessione/provenienza verificabile; rotazione della connessione; replay di evento con consegna ripetuta; timeout dopo creazione webhook; recupero concorrente della stessa credenziale senza duplicare endpoint. Non sono autorizzate da questo documento modifiche al repository o all’installazione Connect reale.

La policy ALORA e il calcolo degli orari sono nel [checkpoint dedicato](verification/appointment-policy-step-12.json). Sono ancora in bozza e non attivano invii o azioni cliente. Il rehearsal di ripristino è nel [resoconto Step 14](release-readiness-step-14.md).
