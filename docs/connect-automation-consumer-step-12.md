# Step 12 — Integrazione consumer Connect 0.12

**Aggiornamento successivo:** adottato lo [SDK rc.2 con ritiro durevole dei comandi](connect-automation-withdrawal-step-12.md). La dipendenza contrattuale descritta in fondo è risolta; questo documento conserva il checkpoint rc.1.

Checkpoint del 10 novembre 2026. **SDK, deleghe e ingresso webhook integrati e verificati in ALORA; automazioni dell’agenda ancora in bozza.** La consegna del provider risolve la precedente assenza del contratto di delega. Non costituisce da sola l’accettazione degli invii o delle azioni cliente. [Evidenze](verification/connect-automation-consumer-step-12.json).

## SDK e autorizzazioni

ALORA installa da archivio locale `vendor/eulab-connect-0.12.0-rc.1.tgz`; manifest, lockfile e Dockerfile usano lo stesso candidato. L’archivio precedente resta conservato. Non è stato pubblicato alcun pacchetto e il repository/runtime Connect non è stato modificato da questa integrazione.

`NotificationAutomationGrant` conserva il comando prima della richiesta centrale, con tenant, autore personale originale, installazione, finalità, canale, funzioni, archivio/sessione WhatsApp e scadenza fissata al primo tentativo. Il server deriva l’autore dalla sessione autorizzata: non accetta identità o token dal job. Le credenziali restano cifrate nel database e non compaiono nella UI, nell’audit o nelle risposte pubbliche.

Creazione concorrente, recupero dopo risposta persa e replay mantengono lo stesso comando e la stessa credenziale. WhatsApp, email e notifiche nell’app richiedono deleghe distinte; la concessione di un canale non abilita gli altri. I worker usano credenziale d’installazione e delega persistita, senza dipendere dalla durata della sessione browser. Prima di un nuovo invio verificano attività, autore e appartenenze locali correnti, quindi l’autorizzazione centrale. Una risposta positiva malformata o un errore del provider non autorizzano l’effetto.

L’invio delegato e la lettura della ricevuta usano l’outbox Connect esistente. La chiave deriva dal tenant e dall’identità stabile del comando di dominio, **senza includere l’ID della delega**: sostituire una delega non crea un nuovo invio del vecchio comando. Uno stato `uncertain` rimane da verificare. L’API HTTP non espone un invio arbitrario attraverso le deleghe.

La revoca ferma subito nuovi invii locali, prima della chiamata centrale. Una risposta persa conserva `revocation_pending`; il recupero ripete la revoca con la credenziale già persistita. Un create ancora non osservabile non viene dichiarato revocato sulla sola base di un `404`: un commit tardivo viene cercato e riconciliato con la stessa chiave. Le ricevute originali restano leggibili dopo revoca/scadenza.

## Ricezione firmata e durevole

`NotificationAutomationWebhook` registra un solo endpoint per attività, con autore e URL originali immutabili. Il recupero SDK conserva ID, segreto e disabilitazione centrale. Un endpoint disabilitato non viene riaperto implicitamente. La console permette configurazione e verifica esplicite, senza presentare la registrazione come prova di consegna pubblica.

Il callback è `POST /api/notifications/automation-webhooks/:id/events`, con il prefisso `/api` gestito dal proxy. Il parser conserva i byte JSON originali fino a 16 MiB, rifiuta decompressione e verifica HMAC/timestamp mediante lo SDK prima del parsing JSON. Il limite ordinario delle altre API resta 100 KiB. Origin e metadati browser non sono ammessi sull’ingresso server. Le intestazioni richieste sono `x-eulab-event-id`, `x-eulab-timestamp` e `x-eulab-signature`.

L’installazione dell’evento deve coincidere con la registrazione e il collegamento corrente. `NotificationAutomationWebhookEvent` deduplica durevolmente per installazione e ID canonico dell’evento, conservando l’hash dei byte. Lo stesso ID con un corpo differente produce conflitto. SQL protegge identità/contenuto, chiusura della ricevuta e conservazione finché l’attività esiste; la cancellazione coerente dell’intera attività nella copia è verificata separatamente.

Solo `message.interactive_response` con provenienza provider, direzione entrante, `fromMe=false`, indirizzamento verificato, timestamp provider e riferimenti coerenti può restare `received` per la futura correlazione. `message.received` non applica una seconda azione. Eventi in uscita, ambigui, non interattivi o successivi alla disabilitazione sono chiusi come ignorati con motivo. Il payload cifrato contiene soltanto riferimenti, indirizzamento, istanti e ID opaco dell’azione; testo libero, media e profilo del cliente non sono conservati.

**Nessuna ricevuta applica ancora una transizione di prenotazione.** La correlazione a intento, piano, destinatario e scadenza, e l’ingresso dei comandi con provenienza cliente, sono il passaggio successivo. Conferma, richiesta di modifica e annullamento non vengono attribuiti al titolare.

## Console e configurazione futura

La sezione «Autorizzazioni delle automazioni» carica i dati su azione esplicita e offre durata, canale, numero WhatsApp, recupero e revoca con conferma. Una risposta persa conserva in `sessionStorage` il comando per attività/autore e blocca un nuovo comando finché quello originale non è recuperato. La revoca da completare è distinta da quella confermata. Mancanza di funzione o accesso all’intera attività impedisce la gestione. Quattro formati verificati: 1440×1050, 1180×820, 820×1180 e 390×844.

L’ambiente di destinazione deve esporre un’origine HTTPS pubblica raggiungibile da Connect. `ALORA_CONNECT_WEBHOOK_ORIGIN` può specificarla; in sua assenza il server usa l’origine del ritorno applicativo configurato. Sono rifiutati HTTP, credenziali nell’URL, porte diverse da 443, percorsi/query e host locali letterali; la risoluzione DNS pubblica resta responsabilità della validazione centrale. Nel collaudo l’origine `.test` è sintetica e non viene contattata. Nessuna impostazione reale è stata modificata.

## Verifiche e limiti

- 9 gruppi HTTP delle deleghe, inclusi processo worker nuovo senza sessione UI, revoca, licenza simulata negata, confini tenant/settore, concorrenza e risposte perse.
- 6 gruppi HTTP webhook sui byte originali, firma, scadenza, conflitti, cifratura minima, provenienza, limiti del parser e recupero endpoint.
- 4 gruppi browser della configurazione, più regressione manuale WhatsApp: 9 gruppi HTTP e 5 browser con SDK 0.12 reale. PostgreSQL, API e scambio OIDC firmato sono reali; Connect/OIDC e trasporti esterni sono sintetici.
- 61 suite, 381 test e uno snapshot; lint e tre build host passati. Migrazione/riapplicazione/ripristino conservano 45 tabelle e 504 colonne originarie, con cinque gruppi SQL e nessuna delega, policy, evento o ricezione inferiti.
- Tre candidati `alora-step12-connect-candidate-{api,admin,booking}:20261110`, con artefatti identici alle build host e otto verifiche di avvio completo su rete interna/database vuoto. Non sono rilasciati nel Docker principale, ancora Step 10.

Non sono provati licenza e runner Connect reali, dispositivo WhatsApp, consegna webhook pubblica o accettazione ALORA. I 180 test e la suite PostgreSQL 14/14 del provider sono parte della consegna riferita dal suo proprietario, non risultati rieseguiti da questo consumer. Gli account reali restano esclusi.

## Completamento dello stesso dominio

Restano il ciclo degli intenti durevoli legato agli eventi/piani autorevoli, il recapito esplicitamente autorizzato, l’integrazione delle deleghe nei singoli canali di `NotificationHistory`/inbox, i template WhatsApp, la correlazione e applicazione delle risposte, la mancata risposta e la gestione operativa degli esiti. La policy mantiene `activationAvailable=false`: creare una delega non abilita i dati storici o i canali preesistenti.

L’integrazione ha inoltre rilevato la necessità del **ritiro del singolo comando già in coda**: revocare la delega condivisa per annullare un appuntamento fermerebbe anche quelli estranei. Il contratto 0.12 consegnato espone invio, stato e revoca dell’intera delega; il [prompt integrativo per l’agente Connect](connect-queued-message-cancellation-request.md) definisce ritiro, corsa col runner/commit tardivo, ricevuta durevole e stati da verificare. Il consumer non inventa un endpoint né dichiara annullato un effetto già iniziato. Il completamento degli step e il rilascio locale restano aperti.
