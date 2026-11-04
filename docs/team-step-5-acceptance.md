# Collaudo operativo Step 5 — Ruoli e squadra

Stato: **casi tecnici del consumer verificati sul Docker reale; collaudo operativo Squadra/La mia agenda accettato dall’utente il 4 novembre 2026; prova email pendente**, dopo
l’autorizzazione dell’utente al collaudo ALORA con Connect schema 014. Non equivale
a chiusura dello Step 5 o accettazione di produzione.
[Prima evidenza](verification/team-real-consumer.json), [prosecuzione estesa](verification/team-extended-consumer.json) e [ultimo ciclo consumer](verification/team-final-consumer.json) e [controllo dopo riavvio](verification/team-post-restart.json).

## Ripresa verificata — 4 novembre 2026

Ripristinato il frontend aggiornato dalla copia `.local/web-admin`, conservata.
Build API e admin passate; suite completa: 226 test su 40 suite, uno snapshot,
tutti passati. Queste verifiche coprono il sorgente e non ripetono il collaudo
SSO/browser del 26 ottobre.

Riavviati i container locali esistenti senza ricreare volumi; nessuna migrazione
pendente e bootstrap demo senza modifiche. Admin e pannello Connect rispondono
200; team e auth/me anonimi rispondono 401. Connessione e autenticazione SMTP
Connect verificate senza inviare email. Keycloak ha SMTP STARTTLS configurato;
questo non prova la consegna del suo link di recupero.
[Evidenza del runtime](verification/team-runtime-resume-2026-11-04.json).

| Condizione di chiusura residua | Stato e prova necessaria |
| --- | --- |
| Recupero password delegato | Non eseguito: identificare un account collaboratore di collaudo e una casella controllata, con autorizzazione all'invio; verificare ricezione del link, cambio nel provider e accesso con nuova credenziale. Non pubblicare link, password o token. |
| Squadra rivista | Collaudo operativo sui dispositivi del salone confermato dall’utente il 4 novembre 2026. |
| La mia agenda | Collaudo operativo sui dispositivi del salone confermato dall’utente il 4 novembre 2026. |

Non ripetere le fixture già rimosse per sostituire queste prove. Non avviare
lo Step 6 prima della chiusura e dell'autorizzazione prevista dal piano.

L’utente ha risposto «Confermo anche il collaudo operativo» alla domanda esplicita su Squadra e La mia agenda sui dispositivi del salone. Questa conferma supera le indicazioni storiche di accettazione pendente sotto. Non attesta la ricezione o l’utilizzo del link password, che resta da verificare separatamente.

## Revisione della UI dopo feedback

La nuova pagina Squadra sostituisce Squadra + Accessi squadra; `/team` reindirizza a `/collaborators`. Preset Titolare/Collaboratore, custom soltanto dopo creazione, attività aggregate al posto dei codici dei permessi. [Revisione corrente](team-presets-passwords.md) ed [evidenza](verification/team-presets-passwords.json). Provato anche il cambio obbligatorio della password temporanea con Keycloak reale. Il recupero del collaboratore è un link provider con nuova abilitazione esplicita team.password.reset, abilitata esplicitamente nella licenza locale e nel ruolo Titolare dopo approvazione dell’utente. Pulsante attivo e conferma annullabile verificati su un collaboratore temporaneo, poi rimosso, senza inviare email. Consegna email non collaudata; cambio della propria password nelle impostazioni previsto nello Step 6. I risultati sotto documentano il collaudo precedente; la nuova UI resta da accettare dall’utente.

## Esiti correnti — 26 ottobre 2026

| Caso | Evidenza reale acquisita | Parte ancora da completare |
| --- | --- | --- |
| R1 | Squadra 200/canManage dopo abilitazione dell’utente in Connect | Accettazione finale utente |
| R2 | Creazione, modifica ed eliminazione dalla UI entro delega; conferma prima dell’eliminazione e altri ruoli conservati | — |
| R3 | Manager ristretto: creazione/modifica/eliminazione ruolo e assegnazione/revoca/restore del target fuori delega: sei 403, sessione valida, nessuna modifica al target | — |
| R4 | Stesso utente SSO reale su due app: cambio ruolo, revoca e ripristino ALORA conservano accesso e funzione qa.read dell’altra app | Catalogo della seconda app sintetico; controllo tramite SDK/API reali |
| R5 | Deselezione di tutti i ruoli dalla UI: salvataggio disabilitato prima della conferma; zero ruoli verificati; riassegnazione esplicita riuscita | — |
| R6–R7 | Revoca dalla UI nega la sessione già aperta; riassegnazione dalla UI e nuovo login riusciti, identità conservata | — |
| L1–L2 | Profilo personale limitato; zero permessi locali nega API e indirizza ad Accesso da configurare | — |
| L3 | Professionista esterno o già occupato rifiutato; associazione e policy precedenti conservate | — |
| L4 | Associazione/rimozione dalla UI su account temporaneo con ruolo locale owner predisposto come fixture; SSO reale e ruoli/permessi conservati | Il titolare preesistente non è stato modificato |
| P1–P2 | Giorno/settimana/mese dalla UI, pagine 25+2 senza duplicati e totali coerenti; solo sette turni propri, eccezione personale e chiusura aziendale | — |
| P3 | Senza consenso locale valori null anche con concessione Connect; con consenso locale 123,45 €, esclusi prodotto e servizio altrui; ricavi aziendali 403 | — |
| P4 | Solo transizione propria; conferma esplicita dalla UI, stato invariato prima della conferma; altri incarichi e transizione inversa vietati | — |
| P5 | Titolare riassegna tramite API reale mentre la UI precedente attende conferma: 403 al salvataggio; stato conservato, vecchia assegnazione assente al refresh | — |
| P6 | Manager e reception con SSO reale leggono/modificano solo i propri appuntamenti; dati aziendali, altri incarichi e altra azienda negati | — |
| I1 | Due aziende con SSO reale: dieci mutazioni incrociate su ruoli/utenti 404; policy esterne 403; associazioni e creazioni con professionista esterno 404; liste separate, nessun residuo e sessioni conservate | Azienda esterna predisposta tramite preassegnazione admin esplicita |
| U1 | Agenda e form squadra a 375×812, 768×1024, 1024×768, 1366×900 senza overflow; campi compilabili, nessun invio involontario; screenshot telefono ispezionati | Collaudo completo su dispositivi fisici |
| C1 | Creazione e login UI reali; password rifiutata dal provider (400), campo svuotato, ripresa UI sullo stesso ID e sessione titolare conservata; login con password recuperata dopo ripetizione della creazione. Account senza password, conflitti email/ID/professionista, mapping/identità sospesi e accesso revocato verificati senza riattivazione implicita | Per gli stati sospesi: SDK consumer reale rifiuta 409; la ripresa ALORA di un intento già completato restituisce il risultato storico senza modificare lo stato. COMMIT remoto perso verificato nel collaudo producer separato |

I test usano tre nuove identità di prova, un ruolo personale, uno per i valori e
uno per il manager ristretto. Nessun privilegio di un account preesistente è
alterato. Tutte le fixture sono state rimosse tramite API amministrativa Connect
per provider/mapping/ruoli e transazione locale per i dati ALORA; cache coinvolte
invalidate. I backup di entrambi i database sono ripristinati in database isolati,
poi eliminati. Riconciliazione: 14 tabelle ALORA e 15 Connect; le sole differenze
ammesse sono i timestamp di login User.updatedAt e di controllo/sync catalogo.
Audit e record runtime di sessione sono fuori dal confronto; l’audit è conservato.
Il test della risposta persa riguarda il tratto ALORA→browser, non simula un
COMMIT remoto perso. Gli appuntamenti/conti sono fixture SQL, non prenotazioni
passate dal motore operativo. Nessun collaudo di produzione o PWA nativa.

## Prosecuzione e riconciliazione

Il secondo ciclo usa quattro nuove identità, due ruoli e 28 appuntamenti sintetici
in un periodo futuro. Tutte le fixture sono state rimosse. Ripristino dei due
backup e riconciliazione 14/14 tabelle ALORA, 15/15 Connect passati. Oltre alle
esclusioni del primo ciclo, i digest dei clienti escludono soltanto lastAlignedAt
e updatedAt: la procedura ordinaria di riallineamento ha aggiornato questi due
campi e nessun altro dato delle quattro anagrafiche esistenti. Audit conservato.

Corretta la perdita di sessione dopo rate limit Connect: il consumer ora riceve
503 e torna a 200 sulla medesima sessione quando il limite scade, senza nuovo
login o retry automatico. Revoche e rinnovi ambigui continuano a negare l’accesso.
Candidata SDK locale aggiornata come indicato in [Step 5](team-step-5.md).
Il collaudo producer separato con PostgreSQL/Keycloak temporanei è passato;
admin Connect e catalogo sono simulati in quella prova, browser consumer escluso.

## Ultimo ciclo consumer prima del riavvio

L’ultimo ciclo chiude le lacune tecniche R4, P6 manager, I1 e recupero UI C1.
La policy temporanea `length(64)` del solo realm di sviluppo è stata ripristinata
alla policy originale vuota, senza cambiare password preesistenti. Un account
recuperato effettua il vero SSO con la password originale anche dopo la ripetizione
della creazione. Il mirror SDK nega i replay su mapping sospesi, identità provider
disabilitate e accessi revocati; l’API ALORA di ripresa degli intenti già completati
non esegue un nuovo provisioning e non riattiva tali stati.

Fixture rimosse: tre identità/provider, quattro ruoli, due installazioni e licenze,
app secondaria e cliente esterno Connect; tre utenti/professionisti/appuntamenti,
due clienti/servizi e azienda esterna ALORA. Riconciliazione estesa con backup
ripristinati: 14/14 tabelle ALORA e 19/19 Connect. Verificati separatamente binding
e segreto decifrato dell’installazione originale. La preassegnazione aveva
normalizzato il solo slug descrittivo del binding sorgente preesistente: ripristino
dal backup con guardia sul valore corrente, quindi tabella integralmente coincidente.
Audit conservato. Il vecchio harness falliva senza verificare lo stato prima di
leggere il corpo; aggiunte asserzioni esplicite. Dopo il riavvio il controllo finale
passa: team e contesto locale 200, un utente/un ruolo/quattro professionisti
originali, logout 201 e richieste anonime o con sessione disconnessa 401. Un 503
precedente al controllo positivo non si è riprodotto durante la diagnostica:
non è attribuito a una causa certa. Diagnostica temporanea e Chromium rimossi.

Restano il collaudo dell’utente sui dispositivi reali e l’accettazione operativa.
Il 26 ottobre l’utente ha confermato che tali prove non erano ancora eseguite.
Questa conferma non viene sostituita dalle prove browser automatizzate.

## Ambiente e prerequisiti

- ALORA sviluppo: [login](http://127.0.0.1:53020/admin/#/login), [Accessi squadra](http://127.0.0.1:53020/admin/#/team), [agenda personale](http://127.0.0.1:53020/admin/#/my-agenda).
- Connect sviluppo: [pannello](http://localhost:8088). Identità, licenza, assegnazioni e delega dell’installazione devono essere attive. Sincronizzare il catalogo ALORA versione 4 (25 funzioni), poi abilitare esplicitamente le funzioni richieste. La sincronizzazione da sola non concede permessi.
- Per amministrare la squadra servono `users.manage` in ALORA e `team.manage` effettivo in Connect e ALORA. Responsabile/reception richiedono anche la concessione locale esplicita. L’amministratore di piattaforma ALORA non è un titolare aziendale.
- Usare account e dati di collaudo. Servono un titolare e, per i casi personali, un account già mappato a questa installazione e presente in ALORA, con un professionista attivo associabile. Per il caso fra aziende serve una seconda azienda di prova. Il seed demo non garantisce account SSO per ogni professionista: la presenza nell’anagrafica non costituisce credenziale o mapping.
- Le prove modificano assegnazioni, policy e stati: annotare le impostazioni iniziali e usare appuntamenti di prova. Non azzerare il database o il seed per predisporle. Non pubblicare token, password o URL callback completi nelle evidenze.

Se un prerequisito manca, segnare il caso «bloccato» e indicare quale. Non creare collegamenti per coincidenza di email e non sostituire una prova utente con il risultato delle fixture.

## Casi disponibili su account esistenti

| ID | Azione manuale | Risultato da verificare |
| --- | --- | --- |
| R1 | Il titolare apre Accessi squadra | Elenco della propria installazione; nessun hash, token o segreto nelle risposte di rete. |
| R2 | Crea e modifica un ruolo con sole funzioni concedibili | Il ruolo resta entro licenza/delega; una funzione fuori delega non è assegnabile. Le impostazioni degli altri ruoli restano conservate. |
| R3 | Prova a modificare un ruolo o utente con privilegi fuori delega | Controlli UI non modificabili; un tentativo API diretto è rifiutato. Nessun aumento della delega e nessuna invalidazione della sessione per il solo errore di business. |
| R4 | Assegna un ruolo a un account di prova | Le sole assegnazioni dell’applicazione cambiano; gli accessi alle altre applicazioni restano conservati. |
| R5 | Deseleziona tutti i ruoli | Il salvataggio resta disabilitato fino alla conferma della perdita di accesso; dopo il salvataggio il destinatario non accede all’app. |
| R6 | Revoca l’accesso a un account di prova | La conferma è esplicita; account e identità restano presenti. La revoca elimina i ruoli di questa app. Nel browser separato del destinatario, una nuova richiesta protetta viene negata. |
| R7 | Sul revocato sceglie «Assegna ruoli per riattivare» e salva un ruolo | L’accesso viene riabilitato entro i permessi del ruolo e della policy locale. Il ripristino diretto è proposto solo quando esistono già assegnazioni. |
| L1 | In «Visibilità in ALORA» configura un collaboratore con sola agenda personale e professionista attivo | Nel suo browser separato vede soltanto la propria agenda; dashboard aziendale, vendite, altri appuntamenti e clienti completi restano inaccessibili anche via API. |
| L2 | Salva esplicitamente zero permessi locali | Alla navigazione successiva il collaboratore è indirizzato ad Accesso da configurare. Le richieste operative dirette vengono negate; profilo e dati non vengono eliminati. |
| L3 | Seleziona un professionista già occupato o di un’altra azienda | Operazione rifiutata; l’associazione precedente e la policy restano coerenti. Nessun collegamento viene sottratto all’altro account. |
| L4 | Il titolare usa «Il mio profilo professionista» | Associa/rimuove il proprio profilo con conferma; ruolo, permessi e credenziali del titolare restano invariati. La propria agenda è raggiungibile solo con il relativo diritto. |
| P1 | L’operatore apre La mia agenda e cambia giorno/settimana/mese | Appuntamenti e indicatori si riferiscono al professionista autenticato e al periodo nella zona aziendale; paginazione coerente. Nessun prezzo, nota interna o storico cliente nelle proiezioni personali. |
| P2 | Consulta I miei orari | Solo settimana tipo ed eccezioni personali; chiusure della propria azienda nel periodo. Nessuna nota interna o turno altrui. Gli orari configurati non sono presentati come slot certamente liberi. |
| P3 | Senza `dashboard.personal.values.read` consulta la pagina | Nessun importo personale; `values` è null. Con concessione Connect e locale esplicite vede le sole righe servizio attribuite, senza prodotti o totali aziendali. Il collaboratore richiede policy locale configurata. |
| P4 | Aggiorna un appuntamento personale confermato | Chiede conferma; ammette solo le transizioni operative indicate. Non permette annullamento aziendale, riapertura di terminali o modifica del prezzo. |
| P5 | Il titolare riassegna un appuntamento prima del salvataggio nel browser del precedente professionista | Il precedente assegnatario non riesce ad aggiornare lo stato. Dopo Aggiorna l’appuntamento non appare fra i suoi. |
| P6 | Come responsabile/reception concede soltanto lettura/scrittura own e collega il professionista | Le API restano limitate alla sua assegnazione anche se il tipo operativo non è collaborator. |
| I1 | Con utenti di due aziende prova letture/modifiche usando ID dell’altra azienda | Nessun dato o modifica estranea è consentito; ruolo/associazione originali conservati. |
| U1 | Usa form squadra e agenda da desktop, tablet verticale/orizzontale e telefono | Controlli leggibili e raggiungibili; nessun salvataggio involontario, nessun reinvio automatico dopo errore di rete. |

Per le prove API usare esclusivamente sessioni di collaudo e ID noti delle fixture. Non confondere un link nascosto con una protezione backend: annotare lo stato HTTP delle richieste negate. Gli stati terminali degli appuntamenti non vanno ripristinati artificialmente; usare un altro appuntamento di prova.

## C1 — Nuovo account collaboratore (casi tecnici verificati; accettazione utente pendente)

L’utente ha approvato la candidata locale SDK 0.11.0 per lo sviluppo e il collaudo
consumer. Il Docker Connect è ora verificato a schema 014; il caso centrale è
passato come indicato nella tabella. I sottocasi seguenti restano distinti per
perimetro di prova: UI consumer, API/SDK consumer e provider temporaneo separato.
[Consegna produttore](../../eulab%20connect/docs/DELEGATED-ACCOUNTS-STEP-5.md).
1. In Accessi squadra scegliere Crea account, compilare nome/cognome/email e ambito operativo, scegliere ruoli Connect concedibili e selezionare i permessi locali. Per l’agenda personale associare un professionista libero e attivo. Nessuna unione con un account esistente per email.
2. Confermare con password iniziale di collaudo facoltativa. Verificare che la UI svuoti il campo. Se omessa, verificare l’indicazione di configurazione dell’accesso provider ancora necessaria; non è inviata un’email da questo form.
3. Se rifiutata per policy, verificare sessione operatore conservata, profilo inattivo salvato e possibilità di riprendere lo stesso ID da Creazioni da completare. Non cambiare anagrafica/ruoli di una creazione già inviata; errori di binding o identità richiedono riconciliazione esplicita.
4. Su un esito incerto, rileggere la lista e usare Riprendi creazione sul medesimo profilo. Verificare assenza di duplicati e conservazione della password dell’identità eventualmente già creata. Non premere ripetutamente o predisporre retry automatici.
5. Dopo conferma, verificare utente e associazione in ALORA, mapping sorgente/installazione/azienda e ruoli in Connect; accedere come nuovo collaboratore in un browser separato ed eseguire L1/P1/P2/P3. Il campo connectAcceptedAt sarà valorizzato dal vero accesso, non dal titolare.
6. Verificare i rifiuti per email/ID occupati, professionista già associato, ruoli fuori delega, altre aziende e identità/mapping sospesi o revocati. Nessuna riattivazione è consentita dalla ripetizione di una creazione.

La preassegnazione EULAB Admin o un login locale non sostituiscono questo caso. Le fixture ALORA attestano PostgreSQL e l’adattatore con SDK simulato, non l’accettazione C1 del provider/browser.

## Registrazione e chiusura

Per ogni ID registrare esito (non eseguito / passato / fallito / bloccato), ruolo e azienda di prova, browser/formato, comportamento osservato e sola evidenza priva di segreti. Data e versione devono identificare il collaudo; eventuali concessioni manuali vanno esplicitate. In caso di errore di rete dopo una scrittura, rileggere lo stato prima di un nuovo invio.

Lo Step 5 si chiude solo dopo C1 e i casi applicabili superati, senza sostituire l’accettazione reale con le 190 prove automatiche del sorgente corrente. Step 6 e successivi restano nel piano; il passaggio di fase segue evolve.md e richiede autorizzazione. Nessuna distribuzione in produzione è implicita nel collaudo locale.
