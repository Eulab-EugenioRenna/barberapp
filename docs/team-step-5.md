# Step 5 — Ruoli e squadra

Stato storico al 25 ottobre 2026 (aggiornamento 0.11.0 in fondo): implementazione avviata su autorizzazione «procedi con il piano». Non concluso. L’accesso all’admin tramite Connect è stato confermato dall’utente nello Step 4; rinnovo, revoca e accettazione di produzione restano prove distinte.

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
3. Aggiornamento 26 ottobre: creazione account e ripresa esplicita implementate con la candidata SDK 0.11.0 autorizzata nello sviluppo. Richiesti aggiornamento operativo Connect a schema 014/API/bootstrap e collaudo C1. Analisi precedente: Il mirror attuale crea local_links; il login-context richiede anche app_local_users. Non assumere che un mirror consenta da solo l’accesso sorgente e non costruire un onboarding parallelo per aggirare questo vincolo.
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

## Quarto blocco: titolare che esegue servizi

La pagina Accessi squadra offre al titolare autorizzato «Il mio profilo professionista»: selezione esplicita del proprio professionista, conferma, rimozione facoltativa dell’associazione e collegamento alla propria agenda se consentita. Dalla vista personale si può tornare all’area aziendale autorizzata. Non si modifica l’ambito del titolare per farlo lavorare come professionista; il normale form Visibilità resta protetto contro modifiche al proprio ruolo o ai titolari.

PUT `/team/me/professional`, funzione `team.manage`, ricava l’ID utente soltanto dalla sessione. Lo stesso SDK pubblico verifica l’installazione e la gestione delegata. Il comando richiede titolare, account Connect attivo, ID locale esplicito, subject e installationId coincidenti con l’account locale. La transazione riusa il lock aziendale e la stessa logica di associazione della policy: professionista attivo nella medesima azienda, nessuna sottrazione di un profilo già associato, predicato finale contro riassegnazione/disattivazione concorrente. Nessun aggiornamento della riga User, delle password, dei permessi o delle assegnazioni Connect. Nessuna nuova migrazione o concessione automatica. Il collegamento alla propria agenda richiede comunque appointments.read.own; gli importi mantengono l’abilitazione personale separata.

Verifiche: 8 nuovi test unitari (mappatura/identità/installazione, delega, stato, collisione, predicato atomico, DTO con ID esplicito anche nullo); suite completa 165/165 su 32 suite. Esteso lo stesso harness PostgreSQL isolato per associazione/rimozione del titolare, collisioni e altro tenant, rollback dopo distacco e confronto integrale della riga User prima/dopo. Fixture sintetica superata e database rimosso. Build API/admin e lint passati. Docker di sviluppo serve i sorgenti aggiornati: GET /api/ e /admin/ 200, PUT anonima 401. Nessun login o modifica degli account reali, nessuna scrittura Connect. Accettazione UI riservata all’utente; Step 5 ancora aperto per contratto di creazione account e collaudo operativo.

### Revoca e riassegnazione nel form squadra

Il contratto Connect di revoca elimina le assegnazioni dell’applicazione. Per un account revocato senza ruoli, la pagina offre «Assegna ruoli per riattivare» invece di proporre un ripristino destinato al conflitto. Il form chiarisce che almeno un ruolo riattiva l’accesso e che la policy locale resta applicata. Il ripristino esplicito resta disponibile quando esistono già assegnazioni. Per salvare una selezione vuota serve confermare la perdita di accesso, anche quando l’account non era revocato. Nessuna nuova API, ripetizione automatica o modifica del comportamento Connect. Build admin e lint verificati; collaudo reale riservato all’utente.

## Quinto blocco: orari personali

Il requisito «orari di disponibilità» di evolve.md §4.2 è ora consultabile anche nella dashboard personale. Lo stesso GET `/dashboard/personal`, entro appointments.read.own e il professionista attivo associato all’utente, restituisce la settimana tipo, le eccezioni del periodo selezionato e le sole date di chiusura dell’azienda. Note delle eccezioni, motivazioni interne delle chiusure, ID delle configurazioni e turni di altri professionisti non sono esposti. Nessun nuovo permesso, endpoint di scrittura o modifica delle regole di prenotazione.

La UI distingue gli orari configurati dagli slot ancora prenotabili: turni, appuntamenti e risorse sono concetti diversi. I giorni senza un turno esplicito restano soggetti agli orari standard già usati dal booking. Non vengono calcolate nuove disponibilità o inventati turni mancanti. Le date delle configurazioni sono date di calendario UTC nel database; il filtro usa i giorni del periodo nella zona dell’azienda, evitando di trattarle come istanti di mezzanotte locale. Chiusure aziendali ed eccezioni coincidenti vengono mostrate una sola volta con priorità alla chiusura.

Suite completa 167/167 su 32 suite, build API/admin e lint passati. Esteso il medesimo harness PostgreSQL isolato: settimana di un altro professionista esclusa, note private escluse, eccezione fuori periodo esclusa, chiusure limitate all’azienda e verifica del 25 ottobre 2026 (cambio d’ora in Europe/Rome). Fixture sintetica passata, database rimosso. Controlli anonimi Docker: API 200 e dashboard personale 401. Nessun login/provider/collaudo utente reale. Restano aperti il contratto di creazione delegata Connect e l’accettazione operativa dello Step 5.

## Collaudo e dipendenza corrente

[Checklist operativa per l’utente](team-step-5-acceptance.md): prerequisiti, ruoli, policy locale, agenda/orari/valori personali, revoche, isolamento, responsive e criterio di chiusura. Tutti i casi manuali restano da eseguire; la creazione di un nuovo account (C1) è bloccata sul metodo SDK completo. Ricontrollati i tipi della distribuzione pubblica installata: mirrorUser accetta il solo profilo legacy, senza contesto applicativo/roleIds, e application.team.createUser non è disponibile. Non è stata creata una variante locale per aggirare il contratto. Il seguito richiede la consegna Connect o un’esplicita scelta dell’utente di affidare a questo agente l’estensione nel repository Connect.

## 26 ottobre — Creazione delegata con candidata SDK 0.11.0

L’utente ha autorizzato «Usa il tarball in sviluppo». Il checksum della consegna Connect coincide: b75d3c46ba8fbcf17dc522083f172abc3d07928c2f697d0f0c8ba182b6b749d5. package.json/lockfile e Docker usano vendor/eulab-connect-0.11.0.tgz; non è una pubblicazione npm o approvazione di produzione. La facciata è la stessa ConnectApplication: TeamService chiama application.team.createUser fuori da services, evitando di riacquisire il medesimo lock SDK. Nessuna copia di OIDC, sessioni, mapping o policy centrali.

In Accessi squadra il titolare/delegato sceglie anagrafica, ruolo operativo ALORA (responsabile/reception/professionista), ruoli Connect concedibili, limiti locali e professionista facoltativo. Password iniziale facoltativa, rimossa dal campo a ogni invio, mai salvata. Se manca, l’esito segnala la configurazione provider necessaria; il form non dichiara di aver inviato email di attivazione. Le credenziali di un’identità esistente non sono reimpostate.

API, tutte con team.manage e verifica SDK dell’installazione:

- POST /team/accounts: ID UUID stabile generato dal form; nessun cliente/installazione/sorgente scelto dal browser.
- GET /team/accounts/pending: creazioni locali da completare della sola azienda autenticata, senza credenziali.
- POST /team/accounts/:id/resume: ripresa esplicita dal profilo/ruoli salvati; solo nuova password transitoria facoltativa.

La nuova tabella TeamAccountIntent è una ricevuta locale dell’intento (profilo esistente per ID, ruoli iniziali, binding, data ed eventuale completamento). Non duplica gli stati di identità/pratica Connect. Il profilo locale viene prima salvato inattivo, con passwordHash casuale inutilizzabile e permissionsConfigured=true. Associazione e ricevuta sono atomiche sotto il lock aziendale; email/ID occupati o professionista altrui non vengono adottati. Il profilo resta inattivo su errore o esito incerto. La finalizzazione controlla gli ID restituiti dal metodo SDK e il binding locale corrente, poi registra subject/installazione e attiva il solo profilo creato. connectAcceptedAt resta vuoto fino all’accesso personale effettivo. Audit richiesto/completato senza password, token o corpi remoti.

Una ripetizione usa lo stesso ID e lo stesso profilo. Non genera altri account, non modifica credenziali o riattiva un profilo completato ma sospeso successivamente. La policy locale di un account ancora in creazione non è modificabile. Password rifiutata, conflitti/mapping/revoche e mancata configurazione provider producono messaggi ALORA ridotti; nessuna risposta remota con dati sensibili viene inoltrata. Nessuna mutazione è ripetuta automaticamente. Una risposta persa o finalizzazione SQL fallita rimane riprendibile da Creazioni da completare.

### Migrazione, verifica e stato operativo

Migrazione ALORA 20261026000000_team_account_intents: sola nuova tabella con FK, indici e metadati; nessuna colonna o riga precedente riscritta. Nel Docker ALORA di sviluppo: API fermata, dump privato .local/team-accounts-before-20261026.dump (0600), checkpoint analyze/apply/verify con scripts/team-policy-migration.cjs e riconciliazione delle tabelle originarie prima della riapertura. Backup ripristinato in database temporaneo e digest originari coincidenti; database di ripristino rimosso. Dopo nuove scritture non ripristinare il vecchio snapshot perdendo i nuovi profili: rollback applicativo compatibile conservando tabella/ricevute/mapping.

Suite ALORA 179 test su 33 suite, build API/admin, lint e Prisma validate passati. scripts/check-team-accounts.cjs usa PostgreSQL isolato obbligatoriamente barber_team_accounts_test_<cifre>, identità/SDK sostituiti da fixture: verifica profilo prima della chiamata, collisioni, rollback/finalizzazione, esito incoerente, password non persistita e invariata in ripetizione, sospensioni, policy/delega e ripresa sullo stesso ID. Non è un test del provider o del nuovo SDK contro Connect reale. I collaudi PostgreSQL/Keycloak della consegna Connect restano evidenze del produttore, distinte dal consumer ALORA.

Il Docker Connect effettivo è stato letto senza modificarlo: schema **013**. Prima del test C1 occorre aggiornare quell’API, applicare schema **014** e bootstrap Keycloak degli attributi riservati secondo docs/DELEGATED-ACCOUNTS-STEP-5.md del repository Connect. Non è stato aggiornato il server Connect, eseguito un login o creato un utente reale. Step 5 ancora aperto per tale aggiornamento concordato e collaudo dell’utente; nessuna distribuzione in produzione.
