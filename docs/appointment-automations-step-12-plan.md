# Step 12 — Eventi appuntamento e automazioni durevoli

Indagine avviata il 9 novembre 2026, entro «procedi con il resto», con account Connect esclusi. La console dello Step 11 è verificata su provider sintetico ma rimane in corso per configurazione/template/risposte e accettazione provider. Questo documento conserva diagnosi e piano; non certifica automazioni operative. Lo stato corrente è nel [resoconto Step 12](appointment-automations-step-12.md).

## Diagnosi prima dell’intervento

`NotificationsEventsService.emit` crea lo storico dopo il commit del comando di dominio e poi accoda su BullMQ. Un arresto fra commit, storico e Redis può perdere un evento o lasciare lavoro non accodato. `NotificationsDispatchService` non acquisisce una riga in modo esclusivo prima dell’effetto esterno e il worker riprova cinque volte dopo un errore: un timeout dopo invio non è distinto da una mancata consegna. Non esistono promemoria durevoli, risposte cliente correlate alla revisione di prenotazione o provider WhatsApp ALORA. Non basta aggiungere un nuovo provider alla lista attuale.

Nel codice Connect verificato (`apps/api/src/auth.ts`, `authorization.ts`, `whatsapp.service.ts`, `whatsapp-bot.service.ts`, `apps/runner/src/main.ts`), gli invii manuali richiedono un token personale; il runner ne verifica nuovamente validità e permesso prima dell’invio. La credenziale di installazione, da sola, non dà un’identità o `whatsapp.send`. Il bot dispone di una delega persistente specifica per archivio/configurazione e autore, con revoca e nuova verifica dei permessi. Non esiste un contratto generale che autorizzi un’applicazione a inviare promemoria di appuntamenti in background. Non si deve riutilizzare un refresh token del browser o dichiarare l’operazione un bot.

## Risultato richiesto

Conferma iniziale, promemoria configurabili, richiesta/risposta di conferma, richiesta di modifica, annullamento e riprogrammazione devono riferirsi al conto e alle righe autorevoli dello Step 10. Le configurazioni devono essere gestibili dalla UI, con template e anticipo/ripetizioni/politica di mancata risposta, senza modifiche al codice. Nessuna nuova impostazione abilita invii sui dati storici implicitamente.

## Sequenza applicativa

1. **Confine transazionale ALORA.** Persistenza dell’evento nella stessa transazione di conto/agenda, con identità stabile e dati/revisione necessari. Riutilizzare lo storico notifiche, le preferenze e BullMQ; aggiungere soltanto l’outbox di dominio e i metadati mancanti. Redis deve poter essere ricostruito dal database. Un replay di un comando non produce un nuovo evento. Inventariare tutti i writer: pubblico/interno, cassa, modifica completa/singola, stato e annullamento.
2. **Delega Connect esplicita e revocabile.** Estendere il contratto API/SDK del proprietario della messaggistica per l’autorizzazione degli invii programmati, limitata a installazione/autore/funzioni e scadenza, con stato verificabile. ALORA conserva soltanto la credenziale cifrata sul backend; non accetta identità dal job o dal browser. Connect e runner ricontrollano delega, licenza e permessi correnti. Nessuna modifica o assegnazione automatica a un account reale nel collaudo.
3. **Invio e riconciliazione.** Acquisizione esclusiva con lease e identità persistita del tentativo; chiave Connect stabile. Prima del primo invio ricontrollare prenotazione/revisione, cliente e autorizzazione al recapito, policy, delega e numero connesso. Distinguere rifiuto definitivo, accettazione in coda, invio e incertezza. Dopo un esito incerto leggere lo stato autorevole; non generare una nuova chiave o reinviare automaticamente. Un crash durante l’effetto esterno non diventa un nuovo invio.
4. **Promemoria e configurazione.** Pianificazione indicizzata dal database e dalle aperture/fusi orari reali, con annullamento degli intenti superati. Salvataggio con revisione e permessi; modifica della policy o della prenotazione invalida gli intenti futuri pertinenti. Template con segnaposto ammessi e anteprima sullo stesso renderer usato nell’invio. Preferenze del recapito distinte dal consenso marketing. Nessun invio di prova senza destinatario reale esplicitamente autorizzato.
5. **Risposte cliente.** Webhook Connect firmato, deduplicato durevolmente e limitato all’installazione collegata; nessun parser di testo libero interpretato automaticamente come comando. Correlazione a intento, destinatario, conto/riga, revisione e scadenza. Conferma/annullamento usano un ingresso applicativo dedicato con provenienza cliente; non impersonano il titolare e non riscrivono prestazioni concluse. “Richiedi modifica” crea una richiesta operativa visibile senza spostare automaticamente l’agenda. Risposte tardive, duplicate, da altro numero o da una vecchia riprogrammazione conservano l’esito senza applicare nuove transizioni.
6. **Interazioni e operatività.** Usare i formati SDK supportati, con capacità/licenza e accettazione sul dispositivo distinti dai test sintetici. La console Step 11 ospita policy/template e lo stato delle automazioni; gli esiti incerti richiedono una gestione esplicita. Nessuna seconda sessione WhatsApp o coda di invio parallela a quella Connect.

## Prove necessarie

Migrazione e riapplicazione con campi originari invariati; rollback dopo le scritture di dominio; crash fra commit e enqueue; Redis indisponibile e ricostruzione; più processi e più worker; replay e chiavi concorrenti; timeout prima/dopo accettazione; esito provider incerto senza reinvio; revoca della delega/licenza/utente/settore; orari/fuso e ripetizioni; modifica e annullamento prima del promemoria; destinatario/recapito cambiato; webhook falso/duplicato/fuori installazione; conferma, modifica richiesta e annullamento coerenti; risposte tardive e fuori revisione.

I test automatici usano copie e provider sintetici. I collaudi su numero/dispositivo reale, le assegnazioni di account, il deployment e l’accettazione commerciale restano gate separati. La mancanza attuale del contratto di delega è lavoro di integrazione da realizzare, non una ragione per dichiarare gli invii programmati già pronti.

## Contratto del provider richiesto

La [richiesta di delega revocabile](connect-automation-delegation-request.md) dettaglia la consegna API/SDK/runner e i relativi collaudi. Il limite corrente assegna il repository Connect al suo agente; è stata chiesta un'autorizzazione esplicita prima di estendere il lavoro a quel codice. Nel frattempo i candidati Docker e l'avvio isolato verificati nello Step 13 non certificano automazioni abilitate o invii reali.

## Configurazione e calendario consegnati separatamente

Il checkpoint della [policy](verification/appointment-policy-step-12.json) aggiunge configurazione persistente con revisione, permessi e autore vincolati al tenant, più un calcolo degli orari riutilizzabile che rispetta calendario e fuso reali. La UI conserva esplicitamente lo stato di bozza: non esiste una via di attivazione senza il contratto centrale. La prova locale dell’orario non crea intenti e non legge recapiti cliente.

Il prossimo passaggio dello stesso dominio deve collegare policy attivata, eventi autorevoli, identità e invalidazione degli intenti e verifica della delega, poi risposta firmata e correlata. Le azioni già configurabili (conferma iniziale e gestione della mancata risposta) non sono dichiarate eseguite dal solo salvataggio. L’assenza del provider non va compensata con una credenziale di installazione o una sessione personale conservata dal browser.

## Aggiornamento del 10 novembre — contratto consegnato

La consegna del proprietario Connect ha fornito delega esplicita, stesso outbox idempotente, recupero webhook/segreto ed eventi interattivi durevoli nello SDK 0.12.0-rc.1. Il [consumer ALORA](connect-automation-consumer-step-12.md) adotta e verifica questi confini con API/database reali e provider sintetico; l’assenza del contratto originario non è più il limite corrente. Restano il collegamento completo degli intenti e dei comandi cliente e il [contratto integrativo di ritiro del singolo invio in coda](connect-queued-message-cancellation-request.md). Account/configurazioni reali, dispositivo e produzione rimangono separati.


## Esito dell’11 novembre 2026

Le sei fasi applicative sono implementate e installate nel Docker locale con SDK 0.12.0-rc.2. Il collegamento include consenso esplicito, piano durevole, deleghe per canale, comandi cliente, ritiro e riconciliazione, avvisi di conferma/annullamento, selezione degli eventi e cinque testi. Eventi arretrati non adottano consensi o calendari successivi. [Resoconto corrente e accettazioni aperte](appointment-automations-workflow-step-12.md). Le diagnosi e i prossimi passi riportati sopra restano la cronologia del piano, non un elenco aggiornato di funzioni mancanti.
