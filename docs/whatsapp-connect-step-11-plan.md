# Step 11 — WhatsApp attraverso Connect

Avviato l’8 novembre dopo la chiusura tecnica locale dello Step 10, entro «procedi con il resto». Account Connect esclusi; nessun pairing, invio o modifica a un numero reale durante i collaudi automatici.

## Diagnosi sul codice attuale

ALORA ha preferenze/template/notifiche generiche, ma nessuna pagina o provider WhatsApp. Il pacchetto installato `@eulab/connect` 0.11.0 espone `ConnectApplication.services` e `ConnectServer.whatsapp`: sessioni, QR, connessione/disconnessione, archivi, conversazioni, messaggi, outbox e messaggi interattivi. Connect conserva la sessione del numero, verifica licenza e permessi per richiesta e gestisce l’outbox; ALORA non deve duplicarli.

Contratti letti nel pacchetto installato e nei sorgenti locali Connect: `packages/sdk/src/{application,server,whatsapp}.ts`, `apps/api/src/{whatsapp.controller,whatsapp.service,authorization}.ts` e `apps/runner/src/main.ts`. Non sono prove sul provider attivo. Gli invii Connect distinguono `queued`, `sending`, `sent`, `uncertain` e `cancelled`: `sent` non prova la lettura del destinatario. Una risposta persa non autorizza una nuova chiave.

## Confine applicativo

Aggiungere un modulo WhatsApp ALORA che usa la sessione SDK già cifrata, con installazione ricavata dal collegamento autorizzato. Nessun token, segreto o installationId dal browser. Funzioni distinte `whatsapp.read`, `whatsapp.send`, `whatsapp.manage`, senza alias alle impostazioni. Sono comunque richiesti identità personale Connect e accesso a tutti i settori: gli archivi Connect sono dell’intera installazione, senza attribuzione affidabile a una sede.

La pagina dedicata espone stato e runner, QR solo a chi amministra, azioni esplicite di collegamento/riconnessione/disconnessione, archivi e conversazioni con messaggi paginati, composizione e stato dell’invio. Testo e QR sono dati non attendibili; nessun HTML del provider. Il contenuto messaggi non entra nell’audit ALORA. Nessuna cancellazione degli archivi richiesta dal piano.

Gli invii manuali conservano destinazione, testo e chiave per azienda/autore prima della richiesta. Si recupera solo la stessa richiesta; la chiave Connect include l’autore. Non si presenta l’accettazione in coda come consegna. Nessun tentativo automatico delle mutazioni. L’aggiornamento della pagina è di sola lettura e termina uscendo dalla vista.

Preferenze, template e risposte appuntamento saranno coordinate con gli eventi durevoli dello Step 12: i provider generici esistenti non saranno etichettati come WhatsApp funzionante prima dell’integrazione.

## Prove e chiusura

Verificare guard e contratto con HTTP/PostgreSQL e SDK contro un provider locale sintetico: isolamento aziendale, permessi indipendenti, revoca, timeout, risposte non valide, QR/archivi, chiave stabile e risposta persa. Browser desktop/tablet/mobile sul BFF isolato, senza account reali. Suite/lint/build e artefatti Docker del candidato prima del rilascio locale.

Pairing, stato del runner reale, messaggistica autorizzata su dispositivo e disponibilità effettiva delle interazioni restano accettazione provider, esplicitamente non provata da un mock. Il piano non autorizza account o ruoli Connect reali.
