# Integrazione Connect — ritiro del singolo invio in coda

**Consegnata e integrata il 10 novembre con SDK 0.12.0-rc.2.** La richiesta sottostante è conservata come contratto del caso d’uso; non è più un blocco aperto. [Implementazione e verifiche consumer](connect-automation-withdrawal-step-12.md).

Richiesta aggiuntiva emersa nell’integrazione ALORA con il candidato 0.12.0-rc.1. Il prompt iniziale non esplicitava questo caso. Non richiede cambi ad account/configurazioni reali, messaggi reali, pubblicazione o deployment.

## Caso concreto

ALORA accoda il promemoria della prenotazione A. Connect restituisce `queued`: non è ancora partito il messaggio. L’operatore annulla o riprogramma A prima dell’acquisizione del runner. ALORA deve poter ritirare solo quel comando. Nel contratto consegnato `automations` espone invio, lettura e revoca dell’intera delega; manca il ritiro per chiave del singolo invio. Revocare la delega condivisa fermerebbe anche promemoria di altre prenotazioni e non rappresenta questa operazione.

## Prompt per l’agente Connect

Integra il contratto e lo SDK aggiungendo il ritiro idempotente di un singolo messaggio delegato, per la stessa identità di comando già usata da `send`/`message`. Usa credenziale installazione e credenziale delega, senza token browser. Conserva le firme attuali e la medesima outbox; i nomi finali dei nuovi metodi sono del provider.

- Vincola ritiro e ricevuta a installazione, delega, finalità, sessione, chiave e payload originale. Una chiave appartenente a un altro comando/delega deve produrre un conflitto, senza cancellare quel messaggio.
- Se l’invio è ancora `queued`, serializza il ritiro con l’acquisizione del runner e conserva uno stato terminale che impedisca al replay di riaccodarlo.
- Gestisci la corsa con un `send` dalla risposta persa o ancora non commesso. Un semplice `404` seguito da un commit tardivo non deve diventare un nuovo invio: definisci serializzazione e ricevuta/tombstone durevole del ritiro. Il consumer possiede già il payload originale e può fornirlo se necessario per quella correlazione.
- Se il tentativo è `sending`, `sent` o `uncertain`, non dichiararlo annullato senza prova. Restituisci un esito tipizzato che distingua ritiro riuscito, stato già terminale ed effetto già iniziato/da verificare. Non cancellare messaggi dal dispositivo e non creare un nuovo tentativo.
- Consenti lettura e ritiro degli intenti pertinenti anche dopo scadenza/revoca della delega, secondo il confine di proprietà già previsto per le ricevute; non autorizzare nuovi invii.
- Conserva idempotenza e stato anche dopo una risposta persa al ritiro, senza creare altre chiavi. Non ruotare credenziali.

Collauda su PostgreSQL/provider sintetici: ritiro prima della presa, concorrenza ritiro/runner, ritiro concorrente con invio ancora non commesso, perdita dell’acknowledgement, replay tardivo di `send`, chiave discordante o di altra delega/installazione, revoca/scadenza e tutti gli stati successivi all’acquisizione. Fornisci contratto aggiornato e nuovo pacchetto SDK candidato locale, senza pubblicarlo.

Il consumer ritirerà i comandi pendenti quando il piano o la policy diventano superati; non prometterà atomicità distribuita fra la modifica della prenotazione e una chiamata già entrata nel provider. L’incertezza degli invii già acquisiti resterà visibile e senza reinvio automatico.
