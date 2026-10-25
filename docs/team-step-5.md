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

1. Implementata l’associazione esplicita e facoltativa di un professionista a un account già presente e collegato a Connect nella stessa azienda; nessuna unione per email. La creazione di nuovi account resta al punto 3.
2. Implementata la configurazione delle restrizioni operative locali per manager/reception/collaboratori, intersecata con Connect e con la delega del chiamante. Collaudo dell’installazione reale ancora da eseguire.
3. Creazione dell’account del collaboratore e mirror/provisioning: verificare il contratto esistente. Il mirror attuale crea local_links; il login-context richiede anche app_local_users. Non assumere che un mirror consenta da solo l’accesso sorgente e non costruire un onboarding parallelo per aggirare questo vincolo.
4. Dashboard personale consolidata con attività, righe servizio attribuite, valori separatamente autorizzati e aggiornamento dello stato operativo. Query/proiezioni/isolamento verificate su PostgreSQL sintetico; collaudo UI dell’utente pendente.
5. Collaudo API/SDK/ruoli e browser sull’installazione effettiva prima della chiusura.

## Evidenze del primo blocco

Test isolati del servizio e censimento catalogo: 13 passati. Sessioni/policy/API frontend/route: 27 passati, compresa la protezione della nuova route team (40 test isolati complessivi). SDK e Connect sono sostituiti da mock in queste prove: nessun login, pratica, migrazione o concessione sull’ambiente dell’utente. Snapshot aggiornato deliberatamente per la nuova funzione e versione. Compilazioni API/admin e lint passati. Il risultato non costituisce accettazione operativa dello Step 5.

Docker di sviluppo aggiornato con le tre immagini ricostruite. Verifiche tecniche su Nginx: API 200, catalogo versione 2 con 23 funzioni e team.manage, GET /api/team senza sessione 401. Nessuna scrittura su utenti/ruoli/licenze Connect eseguita nel controllo.

## Secondo blocco: restrizioni locali e professionista associato

La pagina Accessi squadra offre «Visibilità in ALORA» per gli account locali modificabili della stessa installazione. Il titolare seleziona ambito operativo (responsabile, reception, professionista), permessi e associazione facoltativa a un professionista attivo. Account di titolari, piattaforma e clienti non sono trasformabili; il chiamante non modifica il proprio ambito. La lista dei professionisti usa il contesto aziendale completo, senza troncare il selettore alla prima pagina del catalogo. Profili senza account restano professionisti senza accesso.

GET `/team/local-users` richiede users.manage e restituisce soltanto anagrafiche minime, ambiti e associazioni della stessa azienda. PUT `/team/local-users/:id/policy` richiede team.manage, verifica la presenza dell’ID locale nell’installazione Connect, il limite della delega anche sulle funzioni storiche/non licenziate e il sottoinsieme dei permessi attualmente concedibili al destinatario. L’operazione cambia soltanto la policy ALORA: nessun ruolo, identità o licenza Connect viene modificato. Un account centrale non ancora presente in ALORA non viene creato implicitamente da questo endpoint.

Associazione e policy vengono salvate nella stessa transazione, con lock aziendale. Un professionista già collegato non viene sottratto a un altro account; riferimenti esterni all’azienda e vecchi collegamenti incoerenti sono rifiutati. Gli ID locali restano opachi (nessun nuovo vincolo UUID sui professionisti legacy). Revoche e restrizioni vengono verificate nelle query API; la UI rilegge auth/me a ogni navigazione e un collaboratore senza lettura dell’agenda viene instradato ad Accesso da configurare.

La colonna additiva User.permissionsConfigured, default false, distingue la policy legacy mai configurata da un salvataggio esplicito. Solo per il collaboratore, false conserva il precedente diritto alla propria agenda (sempre entro Connect); true applica le sole funzioni personali selezionate e un array vuoto nega ogni permesso operativo. La policy non amplia il ruolo collaboratore a dati aziendali. Manager/reception mantengono il precedente controllo sui permessi espliciti. Nessuna password o associazione Connect viene riscritta.

L’adattatore team cattura i fallimenti dell’operazione all’interno della callback services e li rilancia dopo il ritorno dello SDK. Questo evita che un conflitto, una validazione o un rifiuto della delega venga interpretato dalla facciata pubblicata come invalidazione della sessione SDK. Gli errori di autenticazione della facciata restano fail-closed; nessuna mutazione viene ripetuta.

### Migrazione e prove

- Migrazione: `20261025000000_user_permissions_configured`, solo aggiunta di una colonna con default false. La release precedente può ignorarla; non viene eliminato alcun campo.
- Eseguire `node scripts/team-policy-migration.cjs analyze checkpoint.json`, fermare tutti gli scrittori e usare `ALORA_MIGRATION_WRITES_FROZEN=1 node scripts/team-policy-migration.cjs apply checkpoint.json`, infine `verify`. Il checkpoint vincola il database e confronta conteggi/digest di tutte le colonne originarie dei dati operativi; migrazioni, audit e sessioni runtime sono esclusi. Nessun dato di riga è registrato nel checkpoint.
- PostgreSQL isolato: `scripts/check-team-local-policy.cjs`, accetta soltanto database vuoti con nome barber_team_policy_test_<cifre>. Usa fixture sintetiche e SDK/Connect sostituiti da un adattatore di prova; verifica migrazione, hash e permessi legacy, array vuoto, associazione e collisione, rollback atomico, delega, account protetti e isolamento aziendale. Non esegue login o richieste Connect. Il database va creato e rimosso esplicitamente dall’operatore del test.
- Docker ALORA locale: API fermata durante migrazione, backup completo privato conservato in `.local/team-policy-before-20261025.dump` (0600), checkpoint in `.local/team-policy-before-20261025.json`. Migrazione applicata e riconciliata prima della riapertura. Ripristino del backup provato in un altro database, con digest/conteggi delle colonne originarie coincidenti; database della prova di ripristino rimosso. Nessuna verifica di produzione.
- 41 test isolati passati in 5 suite; build API/admin e lint passati. Accettazione del form e prove di creazione account restano dell’utente.

Controlli finali del runtime aggiornato: API 200; GET team e GET team/local-users senza sessione 401. In caso di errore di scrittura la pagina presenta un esito da verificare e invita a rileggere lo stato: un errore di rete dopo commit non viene dichiarato come garanzia di mancata modifica.

## Terzo blocco: dashboard personale e aggiornamento dell’esecuzione

La vista `/admin/#/my-agenda` ora usa GET `/dashboard/personal` invece del caricamento dell’agenda aziendale (che, con soli permessi personali, restituiva sempre un array vuoto). Offre giorno/settimana/mese nella zona dell’azienda, pagine da 25 appuntamenti e indicatori aggregati sull’intero periodo: appuntamenti, completati, assenze/annullati e quantità di righe servizio attribuite nei conti. Nessun ID professionista, cliente o azienda è accettato dalla query: viene usata la relazione attiva dell’account autenticato e tutti i filtri restano aziendali/personali, anche per responsabili o reception con soli permessi own.

Il catalogo versione **3** espone **24 funzioni**. La nuova `dashboard.personal.values.read` richiede abilitazione esplicita Connect e permesso locale; per il collaboratore richiede anche permissionsConfigured=true. Senza concessione, la query degli importi non viene eseguita e values è null. La selezione economica riguarda soltanto la somma Decimal esatta delle lineTotal dei servizi attribuiti al professionista, con servizio e conto nella stessa azienda e conti non cancellati. Prodotti, righe senza servizio/attribuzione e conti di altre aziende restano fuori. Non si sommano importi degli appuntamenti per ricostruire vendite mancanti, non si deducono compensi/provvigioni e non si dichiara incassato questo valore. Gli sconti complessivi non vengono riallocati prima del dominio economico dedicato.

Le proiezioni personali di lista, dettaglio e stato escludono prezzi, note interne, storico cliente, costi e altri campi aziendali anche sulle API legacy. La cache personale usa una nuova versione per non riutilizzare vecchie risposte più ampie. Le sole note visibili sono quelle operative del cliente per l’appuntamento assegnato. Riferimenti incrociati ad aziende diverse sono filtrati anche nelle relazioni cliente/servizio/stanza.

POST `/appointments/:id/status` riusa l’endpoint esistente con il permesso own. In ambito personale ammette requested→confirmed, confirmed→checked_in/completed/no_show, checked_in→completed; non riapre terminali e non sostituisce la procedura aziendale di annullamento/riprogrammazione. La scrittura vincola atomicamente azienda, professionista, relazione attiva all’utente e stato precedente: una riassegnazione o transizione concorrente non viene aggiornata dal vecchio assegnatario. Un operatore con sola scrittura own riceve soltanto id/status, senza dettagli cliente. UI con conferma esplicita ed esito da verificare su errore, nessun reinvio automatico delle mutazioni.

### Prove del terzo blocco

- Suite Jest completa: 157 test passati su 31 suite, con fixture SDK/identità e nessun collaudo utente reale. Corrette due fixture auth/catalogo che ereditavano il presenter dal .env e non simulavano configuration.sync; ora coprono esplicitamente il presenter senza contattare servizi reali.
- `scripts/check-personal-dashboard.cjs`: PostgreSQL isolato, dati sintetici di due aziende e più professionisti. Verifica proiezioni, quantità/importi esatti, prodotti/conti cancellati/riferimenti esterni esclusi, ambiti personalizzati manager, scrittura senza lettura e riassegnazione concorrente fra lettura e update. Identità, notifiche e cache sono fixture; non certifica il provider o la UI reale. Il database usa obbligatoriamente il prefisso barber_personal_dashboard_test_<cifre> ed è rimosso dopo la prova.
- Compilazioni API/admin e lint passati. Nessuna nuova migrazione o concessione a utenti reali per questo blocco.

### Creazione account: contratto da completare in Connect

Il checkout conferma che mirror scrive local_links ma il login-context richiede app_local_users. Registrazione sorgente/azienda e assegnazione delegata non sono un unico contratto di creazione esposto dallo SDK 0.10.0. [Richiesta tecnica pronta per l’agente Connect](connect-delegated-account-request-step-5.md): estendere lo stesso mirror e la facciata, riusando binding e delega, senza API parallele o collegamenti per email. ALORA resta sul pacchetto pubblico 0.10.0 e non presenta un pulsante di creazione falsamente operativo. Questo requisito e il collaudo dell’utente tengono lo Step 5 aperto.

L’adattatore SDK restrict vincola le risorse own al professionista autenticato anche quando il tipo operativo è manager/reception; non basta essere nella stessa azienda. Ulteriori test coprono assenza di associazione, risorsa di un altro professionista o tenant e conservazione dei controlli sulle normali funzioni aziendali.

Runtime Docker aggiornato: API 200; catalogo pubblicato versione 3 con 24 funzioni; GET dashboard/personal senza sessione 401. Si tratta di controlli tecnici anonimi, non di un nuovo login o di una concessione sulla licenza reale.
