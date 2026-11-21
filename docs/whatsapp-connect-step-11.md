# Step 11 — Console WhatsApp Connect

**Console implementata e installata nel Docker locale, aggiornata l’11 novembre 2026 con SDK 0.12.0-rc.2.** QR, connessione, conversazioni, invio manuale recuperabile, autorizzazioni distinte, configurazione e monitoraggio sono collegati al [flusso appuntamenti](appointment-automations-workflow-step-12.md). Sono passati i controlli consumer con SDK reale e provider sintetico; pairing, invio/ricezione, interazioni e webhook pubblico reali restano da accettare. Nessuna operazione su account o ruoli Connect e nessun messaggio reale. [Evidenze correnti](verification/appointment-automations-workflow-step-12.json).

## Checkpoint storici del 9–10 novembre

Le evidenze seguenti conservano SDK, immagini e limiti di ciascun checkpoint precedente. Le frasi su runtime Step 10 e requisiti applicativi ancora da completare descrivono quel momento; lo stato corrente è quello indicato sopra.

**Aggiornamento del 10 novembre:** regressione di invio manuale verificata anche con SDK **0.12.0-rc.1** (9 gruppi HTTP, 5 browser). La console aggiunge [autorizzazioni distinte, revoca e ricezione delle risposte](connect-automation-consumer-step-12.md), con quattro gruppi browser dedicati e nuovi candidati Docker isolati. Le evidenze del primo checkpoint riportate sotto restano riferite allo SDK e alle immagini di quel momento; il runtime principale non è aggiornato.

La pagina consente stato del numero e del servizio, QR per amministratori, collegamento, riconnessione e disconnessione espliciti, archivi/conversazioni e paginazione dei messaggi. Offre messaggi di testo manuali con destinatario e autorizzazione dichiarati, e gli stati dell’outbox Connect. Non crea una seconda sessione WhatsApp o una seconda outbox del provider. Una risposta persa conserva il comando in `sessionStorage` per attività/autore: il recupero usa URL, contenuto e chiave originari. La chiave presso Connect è derivata anche dall’autore locale. `queued` e `sent` non vengono presentati come conferma della lettura; `uncertain` rimane da verificare, senza reinvio automatico.

Il BFF deriva installazione, token e sessione dai collegamenti autorizzati. Verifica i permessi `whatsapp.read`, `whatsapp.send`, `whatsapp.manage` separatamente, senza alias alle impostazioni; richiede anche identità personale e accesso a tutti i settori, perché Connect non attribuisce le conversazioni a una sede ALORA. Le funzioni sono nel catalogo versione **7**, ora di **32 funzioni**; non sono state assegnate ad account reali.

Il QR ammette soltanto PNG inline entro il limite previsto; HTML, avatar remoti, credenziali e payload provider non passano nelle proiezioni. I contenuti messaggio vengono mostrati come testo. Le mutazioni richiedono l’origine browser configurata. L’audit conserva operazione e identificatori, senza testo, telefono o chiave del comando. Un errore di autorizzazione rimuove conversazioni e QR dalla pagina. Le mutazioni non hanno retry automatici.

## Evidenze del primo checkpoint

- Nove gruppi HTTP con database temporaneo, sessioni locali autentiche, store cifrato dello SDK e un vero scambio OIDC firmato contro il simulatore: isolamento installazioni; permessi/ambiti; QR e proiezioni; paginazione a 50; comandi idempotenti; risposta persa dopo la registrazione; revoca; timeout/risposte malformate; stato della connessione e audit.
- Cinque gruppi browser sullo stesso BFF: desktop 1440, tablet 820 e mobile 390; QR solo all’amministratore, conversazioni/testo non eseguibile, paginazione, azioni di connessione, congelamento e recupero dopo reload, nessun doppio invio, revoca e scorrimento mobile. Screenshot ispezionati.
- **59 suite, 356 test e 1 snapshot** passati; lint e build API/amministrazione/pubblico passati. Nessuna migrazione di schema richiesta da questo modulo.
- Gli script di prova sono esclusi dal runtime API Docker. Per questo step le immagini non sono ancora ricostruite o rilasciate. [Piano](whatsapp-connect-step-11-plan.md) · [Report](verification/whatsapp-connect-step-11.json).

## Requisiti aperti al primo checkpoint

L’editor/anteprima email e delle notifiche nell’app è ora implementato nella console e [verificato separatamente](verification/notification-templates-step-12.json), con permesso `notifications.manage`, appartenenza all’intera attività e controllo della versione. Non attiva canali né invia prove. Restano configurazione delle automazioni, template WhatsApp e risposte agli appuntamenti. Occorre completare il contratto di delega per invii programmati indipendenti dalla sessione browser: il bot Connect ha una delega durevole specifica, mentre `sendText` usa il token dell’operatore. Non va estesa implicitamente quella delega agli appuntamenti. La diagnosi e la sequenza di integrazione sono nel [piano Step 12](appointment-automations-step-12-plan.md).

Prima del rilascio locale restano l’integrazione dei requisiti sopra, regressioni pertinenti e confronto degli artefatti Docker. L’accettazione provider comprende QR/numero reale, invio e ricezione, revoca e formati interattivi su dispositivo. Produzione e validazione commerciale restano separati, negli step successivi.

## Recupero del runtime locale del 9 novembre

All’inizio della sessione PostgreSQL, Redis e Mailhog ALORA erano arrestati con codice 255 e l’API era in attesa del database. Sono stati riavviati i contenitori esistenti, senza ricrearli o modificare volumi e account. L’API è tornata sana e `/api/health` risponde 200. La policy `unless-stopped` è ora presente anche per questi tre servizi in Compose e sui contenitori locali, coerentemente con i servizi applicativi. Non è una prova di ripristino dopo guasto del disco o dell’intero deployment.

## Candidato Docker condiviso con lo Step 13

Le tre immagini candidate comprendenti la console sono ora costruite e coincidono con gli artefatti host collaudati; il modulo API completo si avvia su PostgreSQL/Redis temporanei senza seed di account. Le [evidenze Step 13](verification/dashboard-responsive-step-13.json) registrano questo avanzamento e la conservazione dei dati nel rehearsal. Il runtime principale rimane allo Step 10. Configurazione, delega, promemoria e risposte cliente dello Step 12, collaudo provider e rilascio rimangono aperti.

Il successivo editor è compreso nei nuovi candidati `alora-step12-templates-candidate-{api,admin,booking}:20261109`, verificati nel report dedicato. I precedenti candidati Step 13 restano il checkpoint antecedente all’editor; nessuno dei due insiemi è distribuito sul runtime principale.

Il checkpoint ancora successivo della [policy in bozza](verification/appointment-policy-step-12.json) aggiunge configurazione persistente e anteprima degli orari sulle aperture e sul fuso reali, nei candidati `alora-step12-policy-candidate-{api,admin,booking}:20261109`. Non attiva promemoria, conferme, segnalazioni o risposte cliente. La delega e il percorso durevole degli invii restano da integrare; il runtime principale rimane allo Step 10.
