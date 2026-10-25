# Step 5 — Ruoli e squadra

Stato 25 ottobre 2026: implementazione avviata su autorizzazione «procedi con il piano». Non concluso. L’accesso all’admin tramite Connect è stato confermato dall’utente nello Step 4; rinnovo, revoca e accettazione di produzione restano prove distinte.

## Primo blocco implementato: amministrazione delegata

La pagina `/admin/#/team` («Accessi squadra») legge account e ruoli dell’installazione autenticata e permette creazione/modifica/eliminazione dei ruoli, sostituzione delle assegnazioni, revoca e ripristino dell’accesso ALORA. Le modifiche richiedono conferma dove distruttive e non vengono ripetute automaticamente. Account e assegnazioni fuori dalla delega non vengono proposti come modificabili; Connect applica comunque i controlli autorevoli sulle API.

`TeamService` usa la stessa ConnectApplication già utilizzata dall’autenticazione, attraverso `application.services(handle, (client, token) => ...)` e i metodi team dello SDK pubblico 0.10.0. Non introduce credenziali o sessioni parallele. Handle SDK, azienda e installazione provengono dalla sessione backend, mai dal browser. Lo SDK verifica la sessione corrente e Connect mantiene i limiti su cliente, applicazione, licenza, delega, ruoli storici e privilegi del destinatario.

API ALORA:

- GET `/team`: elenco, funzione locale `users.manage`.
- POST `/team/roles`, PUT/DELETE `/team/roles/:id`: ruoli, funzione `team.manage`.
- PUT `/team/users/:id/roles`: assegnazioni, funzione `team.manage`.
- DELETE `/team/users/:id/access`, POST `/team/users/:id/restore`: accesso alla sola installazione, funzione `team.manage`.

DTO validano nomi, funzioni e ID delle assegnazioni. Le risposte d’errore Connect vengono ridotte a messaggi ALORA; nessun corpo provider o token viene inoltrato. Il normale interceptor di audit registra le mutazioni, senza dati del form.

Il catalogo versione **2** espone **23 funzioni**: aggiunta `team.manage`, senza concessione legacy al titolare. Per gli account SSO il titolare ottiene questa funzione soltanto se presente nelle concessioni Connect; manager/reception richiedono anche il permesso locale esplicito. Collaboratori e amministratori di piattaforma restano esclusi da questi endpoint aziendali.

## Abilitazione da collaudare dall’utente

Dopo aver sincronizzato il catalogo ALORA in Connect, abilitare esplicitamente `team.manage` nella licenza/abilitazioni e nel ruolo/delega dell’operatore. Non è stata eseguita alcuna concessione automatica sull’installazione reale. Il contratto Connect permette lettura senza team.manage soltanto quando l’app non dichiara tale funzione e il chiamante ha una delega valida; quando l’app la dichiara, il controllo Connect può negare anche la lettura. La pagina gestisce il 403 indicando di verificare licenza, ruolo e delega.

Verificare manualmente un ruolo entro delega, un tentativo fuori delega, assegnazioni di account più privilegiati, revoca/ripristino e conservazione degli accessi alle altre applicazioni. Le prove su utenti reali restano dell’utente.

## Attività ancora necessarie per completare lo Step 5

1. Associazione esplicita e facoltativa fra professionista e account locale della stessa azienda, senza unione per email.
2. Configurazione delle restrizioni operative locali, applicata anche via API e sempre intersecata con Connect, conservando i comportamenti legacy durante la migrazione.
3. Creazione dell’account del collaboratore e mirror/provisioning: verificare il contratto esistente. Il mirror attuale crea local_links; il login-context richiede anche app_local_users. Non assumere che un mirror consenta da solo l’accesso sorgente e non costruire un onboarding parallelo per aggirare questo vincolo.
4. Consolidamento della dashboard personale e verifica di assenza di dati aziendali o altrui.
5. Collaudo API/SDK/ruoli e browser sull’installazione effettiva prima della chiusura.

## Evidenze del primo blocco

Test isolati del servizio e censimento catalogo: 13 passati. Sessioni/policy/API frontend/route: 27 passati, compresa la protezione della nuova route team (40 test isolati complessivi). SDK e Connect sono sostituiti da mock in queste prove: nessun login, pratica, migrazione o concessione sull’ambiente dell’utente. Snapshot aggiornato deliberatamente per la nuova funzione e versione. Compilazioni API/admin e lint passati. Il risultato non costituisce accettazione operativa dello Step 5.

Docker di sviluppo aggiornato con le tre immagini ricostruite. Verifiche tecniche su Nginx: API 200, catalogo versione 2 con 23 funzioni e team.manage, GET /api/team senza sessione 401. Nessuna scrittura su utenti/ruoli/licenze Connect eseguita nel controllo.
